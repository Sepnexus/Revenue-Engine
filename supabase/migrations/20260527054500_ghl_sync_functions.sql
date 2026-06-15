-- ============================================================================
-- GHL sync engine — manual "Sync now" + the building blocks for the eventual
-- pg_cron nightly job.
--
-- Same two-call pattern as test_connection / list_pipelines:
--   1. ghl_sync_page_start(org, pipeline, cursor, cursor_id) → request_id
--   2. Frontend polls ghl_request_result(request_id) until done
--   3. ghl_sync_page_finish(org, request_id) → parses, upserts into
--      ghl_opportunities, returns { rows_synced, next_cursor }
--   4. Repeat until next_cursor IS NULL, then call ghl_sync_finalize(org)
--   5. ghl_sync_finalize derives KPI counts from ghl_opportunities using
--      ghl_stage_mapping and writes into kpi_periods.data for the current month
--
-- Pagination: GHL's /opportunities/search uses startAfter (timestamp) +
-- startAfterId (uuid) cursors. We pass them as query params.
--
-- The frontend orchestrates the loop (iterate selected pipelines × pages) so
-- the user gets per-page progress in the UI. The server functions are
-- stateless per page; sync_state row gets updated on finalize.
-- ============================================================================

-- ─── _ghl_dispatch_get is defined in the earlier migration ──────────────────
-- We re-use it here for the opportunities/search endpoint.

-- ─── Public RPC: kick off one page of an opportunities sync ─────────────────
CREATE OR REPLACE FUNCTION public.ghl_sync_page_start(
  p_org_id      UUID,
  p_pipeline_id TEXT,
  p_cursor      TEXT DEFAULT NULL,
  p_cursor_id   TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id TEXT;
  v_pit         TEXT;
  v_url         TEXT;
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
    RAISE EXCEPTION 'org has no saved GHL credentials';
  END IF;

  -- Build the URL. GHL accepts location_id (snake_case) on this endpoint.
  v_url := 'https://services.leadconnectorhq.com/opportunities/search'
        || '?location_id=' || v_location_id
        || '&limit=100';
  IF p_pipeline_id IS NOT NULL AND length(p_pipeline_id) > 0 THEN
    v_url := v_url || '&pipeline_id=' || p_pipeline_id;
  END IF;
  IF p_cursor IS NOT NULL AND length(p_cursor) > 0 THEN
    v_url := v_url || '&startAfter=' || p_cursor;
  END IF;
  IF p_cursor_id IS NOT NULL AND length(p_cursor_id) > 0 THEN
    v_url := v_url || '&startAfterId=' || p_cursor_id;
  END IF;

  RETURN public._ghl_dispatch_get(v_url, v_pit);
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_page_start(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ─── Public RPC: process the response, upsert opportunities, return cursor ──
-- Returns: {
--   ok, rows_synced, has_more, next_cursor, next_cursor_id, sample (first 3 rows for debug)
-- }
CREATE OR REPLACE FUNCTION public.ghl_sync_page_finish(
  p_org_id     UUID,
  p_request_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_resp      RECORD;
  v_body      JSONB;
  v_opps      JSONB;
  v_op        JSONB;
  v_spend_key TEXT;
  v_rows      INT := 0;
  v_next_cur  TEXT;
  v_next_id   TEXT;
  v_last_cf   JSONB;
  v_spend     NUMERIC(14,2);
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  -- Read the pg_net response. If still pending, return that so the frontend
  -- can keep polling.
  SELECT id, status_code, content, error_msg
    INTO v_resp
    FROM net._http_response WHERE id = p_request_id;

  IF v_resp.id IS NULL THEN
    RETURN jsonb_build_object('pending', true);
  END IF;

  IF v_resp.error_msg IS NOT NULL OR v_resp.status_code NOT BETWEEN 200 AND 299 THEN
    -- Record the failure on the org so it surfaces in the UI
    UPDATE public.organizations
       SET ghl_last_sync_error = format('HTTP %s on opportunities/search: %s',
                                       COALESCE(v_resp.status_code, 0),
                                       COALESCE(v_resp.error_msg, v_resp.content, 'unknown'))
     WHERE id = p_org_id;
    RETURN jsonb_build_object(
      'ok', false,
      'status', v_resp.status_code,
      'error', COALESCE(v_resp.error_msg, v_resp.content)
    );
  END IF;

  v_body := v_resp.content::jsonb;
  v_opps := COALESCE(v_body->'opportunities', '[]'::jsonb);

  -- Read this org's spend-field key once (NULL if not configured).
  SELECT ghl_spend_field INTO v_spend_key FROM public.organizations WHERE id = p_org_id;

  -- Iterate the page and upsert each opportunity.
  FOR v_op IN SELECT * FROM jsonb_array_elements(v_opps) LOOP
    -- Custom fields can come back as either an array of {id,value} or an
    -- object. Normalize to jsonb so we can query later.
    v_last_cf := COALESCE(v_op->'customFields', v_op->'custom_fields', '[]'::jsonb);
    v_spend := NULL;
    IF v_spend_key IS NOT NULL AND v_spend_key <> '' THEN
      -- Try: array form: [{id|key|name: <key>, value: ...}]
      SELECT (cf->>'value')::numeric
        INTO v_spend
        FROM jsonb_array_elements(v_last_cf) cf
       WHERE (cf->>'id' = v_spend_key OR cf->>'key' = v_spend_key OR cf->>'name' = v_spend_key)
       LIMIT 1;
      -- Object form fallback: {key: value}
      IF v_spend IS NULL AND jsonb_typeof(v_last_cf) = 'object' THEN
        v_spend := (v_last_cf->>v_spend_key)::numeric;
      END IF;
    END IF;

    INSERT INTO public.ghl_opportunities (
      org_id, ghl_opportunity_id,
      ghl_contact_id, pipeline_id, pipeline_stage_id, pipeline_name, stage_name,
      status, monetary_value, assigned_to, source, name,
      custom_fields, spend,
      ghl_created_at, ghl_updated_at, synced_at
    ) VALUES (
      p_org_id, v_op->>'id',
      NULLIF(v_op->>'contactId', ''),
      NULLIF(v_op->>'pipelineId', ''),
      NULLIF(v_op->>'pipelineStageId', ''),
      NULLIF(v_op->>'pipelineName', ''),
      NULLIF(v_op->>'pipelineStageName', ''),
      NULLIF(v_op->>'status', ''),
      NULLIF(v_op->>'monetaryValue','')::numeric,
      NULLIF(v_op->>'assignedTo', ''),
      NULLIF(v_op->>'source', ''),
      NULLIF(v_op->>'name', ''),
      v_last_cf,
      v_spend,
      NULLIF(v_op->>'createdAt','')::timestamptz,
      NULLIF(v_op->>'updatedAt','')::timestamptz,
      now()
    )
    ON CONFLICT (org_id, ghl_opportunity_id) DO UPDATE SET
      ghl_contact_id    = EXCLUDED.ghl_contact_id,
      pipeline_id       = EXCLUDED.pipeline_id,
      pipeline_stage_id = EXCLUDED.pipeline_stage_id,
      pipeline_name     = EXCLUDED.pipeline_name,
      stage_name        = EXCLUDED.stage_name,
      status            = EXCLUDED.status,
      monetary_value    = EXCLUDED.monetary_value,
      assigned_to       = EXCLUDED.assigned_to,
      source            = EXCLUDED.source,
      name              = EXCLUDED.name,
      custom_fields     = EXCLUDED.custom_fields,
      spend             = EXCLUDED.spend,
      ghl_updated_at    = EXCLUDED.ghl_updated_at,
      synced_at         = now();

    v_rows := v_rows + 1;
  END LOOP;

  -- GHL's pagination: meta.nextPageUrl OR meta.startAfter + startAfterId
  -- Different GHL accounts return slightly different shapes; we handle both.
  v_next_cur := COALESCE(v_body->'meta'->>'startAfter',  NULL);
  v_next_id  := COALESCE(v_body->'meta'->>'startAfterId', NULL);

  -- If we got fewer than 100 rows, no more pages regardless of cursor.
  IF v_rows < 100 THEN
    v_next_cur := NULL;
    v_next_id  := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'rows_synced',     v_rows,
    'has_more',        v_next_cur IS NOT NULL AND v_next_id IS NOT NULL,
    'next_cursor',     v_next_cur,
    'next_cursor_id',  v_next_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_page_finish(UUID, BIGINT) TO authenticated;

-- ─── Public RPC: derive KPI counts and write to kpi_periods.data ────────────
-- Reads ghl_selected_pipeline_ids + ghl_stage_mapping from organizations,
-- counts opportunities at the mapped stages from ghl_opportunities, and
-- writes the result into the current month's kpi_periods row.
CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_selected      TEXT[];
  v_mapping       JSONB;
  v_pid           TEXT;
  v_stage_map     JSONB;
  v_pl_contact    INT; v_pl_net INT; v_pl_offer INT; v_pl_contract INT;
  v_pl_spend      NUMERIC(14,2);
  v_contacts      INT := 0;
  v_nets          INT := 0;
  v_offers        INT := 0;
  v_contracts     INT := 0;
  v_spend         NUMERIC(14,2) := 0;
  v_total_opps    INT;
  v_period_start  DATE := date_trunc('month', current_date)::date;
  v_pipeline_breakdown JSONB := '[]'::jsonb;
  v_existing_data JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT ghl_selected_pipeline_ids, ghl_stage_mapping
    INTO v_selected, v_mapping
    FROM public.organizations WHERE id = p_org_id;

  SELECT count(*) INTO v_total_opps FROM public.ghl_opportunities WHERE org_id = p_org_id;

  -- Iterate each selected pipeline and count opps in its mapped stages.
  IF v_selected IS NOT NULL THEN
    FOREACH v_pid IN ARRAY v_selected LOOP
      v_stage_map := v_mapping -> v_pid;
      IF v_stage_map IS NULL THEN CONTINUE; END IF;

      SELECT
        count(*) FILTER (WHERE pipeline_stage_id = v_stage_map->>'contact'),
        count(*) FILTER (WHERE pipeline_stage_id = v_stage_map->>'net'),
        count(*) FILTER (WHERE pipeline_stage_id = v_stage_map->>'offer'),
        count(*) FILTER (WHERE pipeline_stage_id = v_stage_map->>'contract'),
        COALESCE(sum(spend), 0)
      INTO v_pl_contact, v_pl_net, v_pl_offer, v_pl_contract, v_pl_spend
      FROM public.ghl_opportunities
      WHERE org_id = p_org_id AND pipeline_id = v_pid;

      v_contacts  := v_contacts  + COALESCE(v_pl_contact, 0);
      v_nets      := v_nets      + COALESCE(v_pl_net, 0);
      v_offers    := v_offers    + COALESCE(v_pl_offer, 0);
      v_contracts := v_contracts + COALESCE(v_pl_contract, 0);
      v_spend     := v_spend     + COALESCE(v_pl_spend, 0);

      v_pipeline_breakdown := v_pipeline_breakdown || jsonb_build_array(jsonb_build_object(
        'pipeline_id', v_pid,
        'pipeline_name', (SELECT DISTINCT pipeline_name FROM public.ghl_opportunities
                          WHERE org_id = p_org_id AND pipeline_id = v_pid LIMIT 1),
        'contacts',  v_pl_contact,
        'nets',      v_pl_net,
        'offers',    v_pl_offer,
        'contracts', v_pl_contract,
        'spend',     v_pl_spend
      ));
    END LOOP;
  END IF;

  -- Upsert the current month's kpi_periods row. We merge into existing data
  -- so we don't blow away manual channels / reps / pnl.
  SELECT data INTO v_existing_data
    FROM public.kpi_periods
   WHERE org_id = p_org_id AND period_start = v_period_start;

  IF v_existing_data IS NULL THEN
    v_existing_data := '{}'::jsonb;
  END IF;

  v_existing_data := v_existing_data || jsonb_build_object(
    'ghl_channel', jsonb_build_object(
      'contacts',           v_contacts,
      'nets',               v_nets,
      'offers',             v_offers,
      'contracts',          v_contracts,
      'spend',              v_spend,
      'total_opportunities', v_total_opps,
      'pipeline_breakdown', v_pipeline_breakdown,
      'computed_at',        to_jsonb(now())
    )
  );

  INSERT INTO public.kpi_periods (org_id, period_start, data, created_by)
  VALUES (p_org_id, v_period_start, v_existing_data, auth.uid())
  ON CONFLICT (org_id, period_start) DO UPDATE
    SET data = EXCLUDED.data,
        updated_at = now();

  -- Update sync metadata on the org.
  UPDATE public.organizations
     SET ghl_last_sync_at    = now(),
         ghl_last_sync_error = NULL,
         ghl_status          = CASE WHEN ghl_status = 'error' THEN 'active' ELSE ghl_status END
   WHERE id = p_org_id;

  -- Also update sync_state for the eventual cron job's bookkeeping.
  INSERT INTO public.sync_state (org_id, resource, last_full_sync_at, rows_synced_last_run, updated_at)
  VALUES (p_org_id, 'opportunities', now(), v_total_opps, now())
  ON CONFLICT (org_id, resource) DO UPDATE
    SET last_full_sync_at    = now(),
        rows_synced_last_run = EXCLUDED.rows_synced_last_run,
        consecutive_failures = 0,
        last_error           = NULL,
        last_error_at        = NULL,
        updated_at           = now();

  RETURN jsonb_build_object(
    'ok',                  true,
    'period_start',        v_period_start,
    'total_opportunities', v_total_opps,
    'contacts',            v_contacts,
    'nets',                v_nets,
    'offers',              v_offers,
    'contracts',           v_contracts,
    'spend',               v_spend,
    'pipeline_breakdown',  v_pipeline_breakdown
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID) TO authenticated;
