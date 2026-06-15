-- ============================================================================
-- GHL contact-driven KPI model.
--
-- The correct model (per user direction): every GHL contact has a `source`
-- field. Each contact has 1..N opportunities. To get monthly revenue per
-- channel:
--   1. Sync contacts (with their `source`)
--   2. Sync opportunities (already have this) and denormalize `source` onto
--      each opportunity row for fast aggregation
--   3. Admin maps each distinct source string → one of the existing channels
--      (Cold Calling / Direct Mail / PPC / Google / custom)
--   4. Aggregate: WHERE status='won' GROUP BY date_trunc('month', updated_at),
--      mapped_channel → SUM(monetary_value), COUNT(*) — write into
--      kpi_periods.data.channels[] for the matching month
-- ============================================================================

-- ─── ghl_contacts: raw mirror of GHL contacts ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.ghl_contacts (
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ghl_contact_id   TEXT NOT NULL,

  source           TEXT,
  email            TEXT,
  phone            TEXT,
  first_name       TEXT,
  last_name        TEXT,
  full_name        TEXT,
  tags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_fields    JSONB NOT NULL DEFAULT '{}'::jsonb,

  ghl_created_at   TIMESTAMPTZ,
  ghl_updated_at   TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, ghl_contact_id)
);

CREATE INDEX IF NOT EXISTS ghl_contacts_org_source_idx
  ON public.ghl_contacts (org_id, source);

CREATE INDEX IF NOT EXISTS ghl_contacts_org_updated_idx
  ON public.ghl_contacts (org_id, ghl_updated_at DESC);

ALTER TABLE public.ghl_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to ghl_contacts" ON public.ghl_contacts;
CREATE POLICY "Admins full access to ghl_contacts"
  ON public.ghl_contacts FOR ALL
  USING       (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK  (has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Client users can view own org contacts" ON public.ghl_contacts;
CREATE POLICY "Client users can view own org contacts"
  ON public.ghl_contacts FOR SELECT
  USING (org_id = my_org_id(auth.uid()));

GRANT SELECT                         ON public.ghl_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ghl_contacts TO service_role;

-- ─── Add a denormalized `source` onto opportunities for fast aggregation ───
ALTER TABLE public.ghl_opportunities
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS ghl_opportunities_org_status_updated_idx
  ON public.ghl_opportunities (org_id, status, ghl_updated_at DESC);

CREATE INDEX IF NOT EXISTS ghl_opportunities_org_source_idx
  ON public.ghl_opportunities (org_id, source);

-- ─── ghl_source_mapping on organizations ───────────────────────────────────
-- JSONB shape: { "Facebook Ads": "PPC / Google", "Direct Mail Q1": "Direct Mail", ... }
-- Channel names come from the existing Revenue Engine channel taxonomy.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ghl_source_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.ghl_source_mapping IS
  'Maps each distinct GHL contact.source value to one of the Revenue Engine channel names. '
  'Sources not in this map are bucketed into "Other / Unmapped".';

-- ─── Contact sync: dispatch one page of /contacts/ ─────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_contacts_sync_page_start(
  p_org_id    UUID,
  p_cursor    TEXT DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL
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

  v_url := 'https://services.leadconnectorhq.com/contacts/'
        || '?locationId=' || v_location_id
        || '&limit=100';
  IF p_cursor IS NOT NULL AND length(p_cursor) > 0 THEN
    v_url := v_url || '&startAfter=' || p_cursor;
  END IF;
  IF p_cursor_id IS NOT NULL AND length(p_cursor_id) > 0 THEN
    v_url := v_url || '&startAfterId=' || p_cursor_id;
  END IF;

  RETURN public._ghl_dispatch_get(v_url, v_pit);
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_contacts_sync_page_start(UUID, TEXT, TEXT) TO authenticated;

-- ─── Contact sync: process the response ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_contacts_sync_page_finish(
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
  v_contacts  JSONB;
  v_c         JSONB;
  v_rows      INT := 0;
  v_next_cur  TEXT;
  v_next_id   TEXT;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT id, status_code, content, error_msg
    INTO v_resp FROM net._http_response WHERE id = p_request_id;

  IF v_resp.id IS NULL THEN
    RETURN jsonb_build_object('pending', true);
  END IF;

  IF v_resp.error_msg IS NOT NULL OR v_resp.status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.organizations
       SET ghl_last_sync_error = format('HTTP %s on /contacts/: %s',
                                       COALESCE(v_resp.status_code, 0),
                                       COALESCE(v_resp.error_msg, v_resp.content, 'unknown'))
     WHERE id = p_org_id;
    RETURN jsonb_build_object(
      'ok', false, 'status', v_resp.status_code,
      'error', COALESCE(v_resp.error_msg, v_resp.content)
    );
  END IF;

  v_body := v_resp.content::jsonb;
  v_contacts := COALESCE(v_body->'contacts', '[]'::jsonb);

  FOR v_c IN SELECT * FROM jsonb_array_elements(v_contacts) LOOP
    INSERT INTO public.ghl_contacts (
      org_id, ghl_contact_id, source, email, phone,
      first_name, last_name, full_name,
      tags, custom_fields,
      ghl_created_at, ghl_updated_at, synced_at
    ) VALUES (
      p_org_id, v_c->>'id',
      NULLIF(v_c->>'source', ''),
      NULLIF(v_c->>'email', ''),
      NULLIF(v_c->>'phone', ''),
      NULLIF(v_c->>'firstName', ''),
      NULLIF(v_c->>'lastName', ''),
      COALESCE(NULLIF(v_c->>'contactName', ''),
               NULLIF(trim(COALESCE(v_c->>'firstName','') || ' ' || COALESCE(v_c->>'lastName','')), '')),
      COALESCE(v_c->'tags', '[]'::jsonb),
      COALESCE(v_c->'customFields', v_c->'custom_fields', '{}'::jsonb),
      NULLIF(v_c->>'dateAdded','')::timestamptz,
      NULLIF(v_c->>'dateUpdated','')::timestamptz,
      now()
    )
    ON CONFLICT (org_id, ghl_contact_id) DO UPDATE SET
      source         = EXCLUDED.source,
      email          = EXCLUDED.email,
      phone          = EXCLUDED.phone,
      first_name     = EXCLUDED.first_name,
      last_name      = EXCLUDED.last_name,
      full_name      = EXCLUDED.full_name,
      tags           = EXCLUDED.tags,
      custom_fields  = EXCLUDED.custom_fields,
      ghl_updated_at = EXCLUDED.ghl_updated_at,
      synced_at      = now();

    v_rows := v_rows + 1;
  END LOOP;

  v_next_cur := v_body->'meta'->>'startAfter';
  v_next_id  := v_body->'meta'->>'startAfterId';
  IF v_rows < 100 THEN
    v_next_cur := NULL; v_next_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'rows_synced',    v_rows,
    'has_more',       v_next_cur IS NOT NULL AND v_next_id IS NOT NULL,
    'next_cursor',    v_next_cur,
    'next_cursor_id', v_next_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_contacts_sync_page_finish(UUID, BIGINT) TO authenticated;

-- ─── Enrich opportunities with source from their contact ────────────────────
-- Called after both contacts and opportunities are synced. Cheap join-update.
CREATE OR REPLACE FUNCTION public.ghl_enrich_opportunities_with_source(
  p_org_id UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  WITH updated AS (
    UPDATE public.ghl_opportunities o
       SET source = c.source
      FROM public.ghl_contacts c
     WHERE o.org_id = p_org_id
       AND c.org_id = p_org_id
       AND o.ghl_contact_id = c.ghl_contact_id
       AND (o.source IS DISTINCT FROM c.source)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_enrich_opportunities_with_source(UUID) TO authenticated;

-- ─── List distinct sources for the admin to map ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_list_sources(
  p_org_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source',           src,
           'contact_count',    contact_count,
           'opportunity_count', opp_count,
           'won_count',        won_count,
           'won_revenue',      won_revenue
         ) ORDER BY won_revenue DESC NULLS LAST, contact_count DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      COALESCE(NULLIF(c.source, ''), '(no source)') AS src,
      count(DISTINCT c.ghl_contact_id) AS contact_count,
      count(o.ghl_opportunity_id) AS opp_count,
      count(o.ghl_opportunity_id) FILTER (WHERE o.status = 'won') AS won_count,
      COALESCE(sum(o.monetary_value) FILTER (WHERE o.status = 'won'), 0) AS won_revenue
    FROM public.ghl_contacts c
    LEFT JOIN public.ghl_opportunities o
      ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id
    GROUP BY src
  ) s;

  RETURN jsonb_build_object('ok', true, 'sources', v_result);
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_list_sources(UUID) TO authenticated;

-- ─── Save the source → channel mapping ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_save_source_mapping(
  p_org_id  UUID,
  p_mapping JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  UPDATE public.organizations
     SET ghl_source_mapping = COALESCE(p_mapping, '{}'::jsonb)
   WHERE id = p_org_id;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_save_source_mapping(UUID, JSONB) TO authenticated;
