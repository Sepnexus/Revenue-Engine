-- ============================================================================
-- GoHighLevel integration — server-side RPC functions.
--
-- All HTTP work happens INSIDE Postgres via the `pg_net` extension. The
-- frontend calls these functions over PostgREST (`supabase.rpc('ghl_*')`).
--
-- ─── pg_net constraint: two-call pattern ───
-- pg_net is transaction-coupled: net.http_get() only dispatches AFTER the
-- calling transaction commits, then the response shows up in
-- net._http_response asynchronously. So we can't do "fire + poll" in a
-- single function call. Instead:
--   1. Frontend calls a `*_start` RPC → returns a request_id immediately,
--      transaction commits, pg_net dispatches
--   2. Frontend polls `ghl_request_result(request_id)` until ok or timeout
--
-- Auth: every function checks `has_role(auth.uid(), 'super_admin')` first.
-- SECURITY DEFINER so the function can read `organization_secrets` even
-- though the caller (authenticated) can't.
-- ============================================================================

-- Drop the old "sync" functions so we can re-create cleanly.
DROP FUNCTION IF EXISTS public._ghl_http_get_sync(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.ghl_test_connection(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ghl_list_pipelines(UUID);

-- ─── Internal: dispatch a GHL GET via pg_net, return request_id ─────────────
CREATE OR REPLACE FUNCTION public._ghl_dispatch_get(
  p_url TEXT,
  p_pit TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_get(
    url     := p_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || p_pit,
      'Version',       '2021-07-28',
      'Accept',        'application/json'
    )
  ) INTO v_request_id;
  RETURN v_request_id;
END $$;

REVOKE ALL ON FUNCTION public._ghl_dispatch_get(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── Public RPC: check the result of a pg_net request ───────────────────────
-- Returns one of:
--   { "pending": true }                              ← still in flight
--   { "ok": true,  "status": 200, "body": {...} }    ← done, success
--   { "ok": false, "status": 401, "body": {...}, "error": "..." } ← done, fail
CREATE OR REPLACE FUNCTION public.ghl_request_result(
  p_request_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_resp RECORD;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT id, status_code, content, error_msg, created
    INTO v_resp
    FROM net._http_response
   WHERE id = p_request_id;

  IF v_resp.id IS NULL THEN
    RETURN jsonb_build_object('pending', true);
  END IF;

  IF v_resp.error_msg IS NOT NULL THEN
    RETURN jsonb_build_object(
      'pending', false,
      'ok',      false,
      'status',  COALESCE(v_resp.status_code, 0),
      'error',   v_resp.error_msg
    );
  END IF;

  RETURN jsonb_build_object(
    'pending', false,
    'ok',      v_resp.status_code BETWEEN 200 AND 299,
    'status',  v_resp.status_code,
    'body',    CASE WHEN v_resp.content IS NULL OR v_resp.content = ''
                    THEN NULL
                    ELSE v_resp.content::jsonb END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_request_result(BIGINT) TO authenticated;

-- ─── Public RPC: kick off a "test connection" request ───────────────────────
-- Returns the pg_net request_id; frontend then polls ghl_request_result.
CREATE OR REPLACE FUNCTION public.ghl_test_connection_start(
  p_location_id TEXT,
  p_pit_token   TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  IF p_location_id IS NULL OR p_pit_token IS NULL
     OR length(trim(p_location_id)) = 0 OR length(trim(p_pit_token)) = 0 THEN
    RAISE EXCEPTION 'location_id and pit_token are required';
  END IF;

  RETURN public._ghl_dispatch_get(
    'https://services.leadconnectorhq.com/locations/' || p_location_id,
    p_pit_token
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_test_connection_start(TEXT, TEXT) TO authenticated;

-- ─── Public RPC: kick off a "list pipelines" request ────────────────────────
-- Uses stored credentials for the org (admin must have saved them first).
CREATE OR REPLACE FUNCTION public.ghl_list_pipelines_start(
  p_org_id UUID
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id TEXT;
  v_pit         TEXT;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT o.ghl_location_id, s.ghl_pit_token
    INTO v_location_id, v_pit
    FROM public.organizations o
    LEFT JOIN public.organization_secrets s ON s.org_id = o.id
   WHERE o.id = p_org_id;

  IF v_location_id IS NULL OR v_pit IS NULL THEN
    RAISE EXCEPTION 'org has no saved GHL credentials — call ghl_save_config first';
  END IF;

  RETURN public._ghl_dispatch_get(
    'https://services.leadconnectorhq.com/opportunities/pipelines?locationId=' || v_location_id,
    v_pit
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_list_pipelines_start(UUID) TO authenticated;

-- ─── Public RPC: save GHL config (atomic write of secret + config) ──────────
-- (Re-applied; identical to the earlier version. Idempotent.)
CREATE OR REPLACE FUNCTION public.ghl_save_config(
  p_org_id                UUID,
  p_location_id           TEXT,
  p_pit_token             TEXT,                  -- pass NULL to keep existing
  p_selected_pipeline_ids TEXT[] DEFAULT NULL,
  p_stage_mapping         JSONB  DEFAULT NULL,
  p_spend_field           TEXT   DEFAULT NULL,
  p_activate              BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  IF p_pit_token IS NOT NULL THEN
    INSERT INTO public.organization_secrets (org_id, ghl_pit_token, updated_at)
    VALUES (p_org_id, NULLIF(p_pit_token, ''), now())
    ON CONFLICT (org_id) DO UPDATE
       SET ghl_pit_token = EXCLUDED.ghl_pit_token,
           updated_at    = now();
  END IF;

  UPDATE public.organizations SET
    ghl_location_id            = COALESCE(p_location_id,           ghl_location_id),
    ghl_selected_pipeline_ids  = COALESCE(p_selected_pipeline_ids, ghl_selected_pipeline_ids),
    ghl_stage_mapping          = COALESCE(p_stage_mapping,         ghl_stage_mapping),
    ghl_spend_field            = COALESCE(p_spend_field,           ghl_spend_field),
    ghl_status                 = CASE WHEN p_activate THEN 'active' ELSE ghl_status END
  WHERE id = p_org_id;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_save_config(UUID, TEXT, TEXT, TEXT[], JSONB, TEXT, BOOLEAN)
  TO authenticated;
