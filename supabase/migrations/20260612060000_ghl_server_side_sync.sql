-- ============================================================================
-- Server-side GHL sync: cron-driven state machine.
--
-- Until now, syncing required an admin to keep a browser tab open while the
-- frontend looped dispatch→poll→process per page (minutes per client). This
-- migration moves the whole sync server-side:
--
--   • `ghl_sync_jobs` — one row per sync run; tracks phase, cursors, the
--     in-flight pg_net request, and progress counters.
--   • `ghl_cron_tick()` — advances every active job by one step. pg_net
--     dispatches on COMMIT, so each tick processes the response that the
--     previous tick's dispatch produced. Runs every 10 seconds via pg_cron.
--   • `ghl_enqueue_nightly()` — queues a job for every active GHL org.
--     Runs at 02:00 UTC via pg_cron.
--   • `ghl_queue_sync(org)` — admin RPC behind the "Sync now" button; just
--     enqueues. The UI polls the job row instead of holding the sync open.
--
-- The page-processing logic is extracted from the existing browser-path RPCs
-- into internal `_ghl_process_*` functions so both paths share one upsert
-- implementation. The browser-path RPCs are recreated as thin wrappers.
--
-- Trigger fix: save_kpi_revision() raised 'Unauthorized revision save' for
-- any writer without auth.uid() — which is exactly what cron is. System
-- writes are now allowed and logged with edited_by = NULL.
--
-- Deploy note (VPS): pg_cron only runs jobs in cron.database_name. Locally
-- that's 'postgres' (matches). On the single-container VPS the app DB is
-- 'revenue_engine' — postgresql.conf there needs cron.database_name set
-- accordingly before these schedules fire.
-- ============================================================================

-- ─── 0. Trigger fix: allow system (cron / service_role) writes ──────────────
CREATE OR REPLACE FUNCTION public.save_kpi_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Callers fall into three classes:
  --   1. a user in this org            → allowed
  --   2. a super_admin                 → allowed
  --   3. system context (no auth.uid() — cron tick, service_role jobs)
  --      → allowed, revision logged with edited_by = NULL
  IF auth.uid() IS NOT NULL AND NOT (
    EXISTS (SELECT 1 FROM public.profiles   WHERE id = auth.uid() AND org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized revision save';
  END IF;
  IF OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO public.kpi_period_revisions (kpi_period_id, org_id, data, edited_by)
    VALUES (OLD.id, OLD.org_id, OLD.data, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 1. Job table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ghl_sync_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | error
  phase                 TEXT,                              -- contacts | opportunities | finalizing
  pipeline_queue        TEXT[] NOT NULL DEFAULT '{}',
  current_pipeline      TEXT,
  cursor                TEXT,
  cursor_id             TEXT,
  in_flight_request_id  BIGINT,
  retry_count           INT  NOT NULL DEFAULT 0,
  rows_contacts         INT  NOT NULL DEFAULT 0,
  rows_opportunities    INT  NOT NULL DEFAULT 0,
  result                JSONB,
  error                 TEXT,
  triggered_by          TEXT NOT NULL DEFAULT 'manual',    -- manual | nightly
  queued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  CONSTRAINT ghl_sync_jobs_status_check CHECK (status IN ('queued','running','done','error'))
);

-- One active job per org at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ghl_sync_jobs_one_active_per_org
  ON public.ghl_sync_jobs (org_id)
  WHERE status IN ('queued','running');

CREATE INDEX IF NOT EXISTS ghl_sync_jobs_active_idx
  ON public.ghl_sync_jobs (status, queued_at)
  WHERE status IN ('queued','running');

ALTER TABLE public.ghl_sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to ghl_sync_jobs" ON public.ghl_sync_jobs;
CREATE POLICY "Admins full access to ghl_sync_jobs"
  ON public.ghl_sync_jobs FOR ALL
  USING      (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

GRANT SELECT ON public.ghl_sync_jobs TO authenticated;  -- RLS limits to admins
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ghl_sync_jobs TO service_role;

-- ─── 2. Internal dispatchers (no auth check — cron + SECURITY DEFINER only) ─
CREATE OR REPLACE FUNCTION public._ghl_dispatch_contacts_page(
  p_org_id UUID, p_cursor TEXT, p_cursor_id TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id TEXT; v_pit TEXT; v_url TEXT;
BEGIN
  SELECT o.ghl_location_id, s.ghl_pit_token
    INTO v_location_id, v_pit
    FROM public.organizations o
    LEFT JOIN public.organization_secrets s ON s.org_id = o.id
   WHERE o.id = p_org_id;
  IF v_location_id IS NULL OR v_pit IS NULL THEN
    RAISE EXCEPTION 'org % has no saved GHL credentials', p_org_id;
  END IF;
  v_url := 'https://services.leadconnectorhq.com/contacts/?locationId=' || v_location_id || '&limit=100';
  IF p_cursor    IS NOT NULL AND length(p_cursor)    > 0 THEN v_url := v_url || '&startAfter='   || p_cursor;    END IF;
  IF p_cursor_id IS NOT NULL AND length(p_cursor_id) > 0 THEN v_url := v_url || '&startAfterId=' || p_cursor_id; END IF;
  RETURN public._ghl_dispatch_get(v_url, v_pit);
END $$;
REVOKE ALL ON FUNCTION public._ghl_dispatch_contacts_page(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ghl_dispatch_opps_page(
  p_org_id UUID, p_pipeline_id TEXT, p_cursor TEXT, p_cursor_id TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id TEXT; v_pit TEXT; v_url TEXT;
BEGIN
  SELECT o.ghl_location_id, s.ghl_pit_token
    INTO v_location_id, v_pit
    FROM public.organizations o
    LEFT JOIN public.organization_secrets s ON s.org_id = o.id
   WHERE o.id = p_org_id;
  IF v_location_id IS NULL OR v_pit IS NULL THEN
    RAISE EXCEPTION 'org % has no saved GHL credentials', p_org_id;
  END IF;
  v_url := 'https://services.leadconnectorhq.com/opportunities/search?location_id=' || v_location_id || '&limit=100';
  IF p_pipeline_id IS NOT NULL AND length(p_pipeline_id) > 0 THEN v_url := v_url || '&pipeline_id='  || p_pipeline_id; END IF;
  IF p_cursor      IS NOT NULL AND length(p_cursor)      > 0 THEN v_url := v_url || '&startAfter='   || p_cursor;      END IF;
  IF p_cursor_id   IS NOT NULL AND length(p_cursor_id)   > 0 THEN v_url := v_url || '&startAfterId=' || p_cursor_id;   END IF;
  RETURN public._ghl_dispatch_get(v_url, v_pit);
END $$;
REVOKE ALL ON FUNCTION public._ghl_dispatch_opps_page(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── 3. Internal page processors (shared by browser path + cron path) ───────
CREATE OR REPLACE FUNCTION public._ghl_process_contacts_body(
  p_org_id UUID, p_body JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contacts JSONB; v_c JSONB;
  v_rows INT := 0; v_next_cur TEXT; v_next_id TEXT;
BEGIN
  v_contacts := COALESCE(p_body->'contacts', '[]'::jsonb);

  FOR v_c IN SELECT * FROM jsonb_array_elements(v_contacts) LOOP
    INSERT INTO public.ghl_contacts (
      org_id, ghl_contact_id, source, email, phone,
      first_name, last_name, full_name, tags, custom_fields,
      ghl_created_at, ghl_updated_at, synced_at
    ) VALUES (
      p_org_id, v_c->>'id',
      NULLIF(v_c->>'source', ''), NULLIF(v_c->>'email', ''), NULLIF(v_c->>'phone', ''),
      NULLIF(v_c->>'firstName', ''), NULLIF(v_c->>'lastName', ''),
      COALESCE(NULLIF(v_c->>'contactName', ''),
               NULLIF(trim(COALESCE(v_c->>'firstName','') || ' ' || COALESCE(v_c->>'lastName','')), '')),
      COALESCE(v_c->'tags', '[]'::jsonb),
      COALESCE(v_c->'customFields', v_c->'custom_fields', '{}'::jsonb),
      NULLIF(v_c->>'dateAdded','')::timestamptz,
      NULLIF(v_c->>'dateUpdated','')::timestamptz,
      now()
    )
    ON CONFLICT (org_id, ghl_contact_id) DO UPDATE SET
      source = EXCLUDED.source, email = EXCLUDED.email, phone = EXCLUDED.phone,
      first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
      full_name = EXCLUDED.full_name, tags = EXCLUDED.tags,
      custom_fields = EXCLUDED.custom_fields,
      ghl_updated_at = EXCLUDED.ghl_updated_at, synced_at = now();
    v_rows := v_rows + 1;
  END LOOP;

  v_next_cur := p_body->'meta'->>'startAfter';
  v_next_id  := p_body->'meta'->>'startAfterId';
  IF v_rows < 100 THEN v_next_cur := NULL; v_next_id := NULL; END IF;

  RETURN jsonb_build_object(
    'rows_synced', v_rows,
    'next_cursor', v_next_cur,
    'next_cursor_id', v_next_id
  );
END $$;
REVOKE ALL ON FUNCTION public._ghl_process_contacts_body(UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ghl_process_opps_body(
  p_org_id UUID, p_body JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_opps JSONB; v_op JSONB; v_spend_key TEXT;
  v_rows INT := 0; v_next_cur TEXT; v_next_id TEXT;
  v_cf JSONB; v_spend NUMERIC(14,2);
BEGIN
  v_opps := COALESCE(p_body->'opportunities', '[]'::jsonb);
  SELECT ghl_spend_field INTO v_spend_key FROM public.organizations WHERE id = p_org_id;

  FOR v_op IN SELECT * FROM jsonb_array_elements(v_opps) LOOP
    v_cf := COALESCE(v_op->'customFields', v_op->'custom_fields', '[]'::jsonb);
    v_spend := NULL;
    IF v_spend_key IS NOT NULL AND v_spend_key <> '' THEN
      SELECT (cf->>'value')::numeric INTO v_spend
        FROM jsonb_array_elements(v_cf) cf
       WHERE (cf->>'id' = v_spend_key OR cf->>'key' = v_spend_key OR cf->>'name' = v_spend_key)
       LIMIT 1;
      IF v_spend IS NULL AND jsonb_typeof(v_cf) = 'object' THEN
        v_spend := (v_cf->>v_spend_key)::numeric;
      END IF;
    END IF;

    INSERT INTO public.ghl_opportunities (
      org_id, ghl_opportunity_id, ghl_contact_id,
      pipeline_id, pipeline_stage_id, pipeline_name, stage_name,
      status, monetary_value, assigned_to, source, name,
      custom_fields, spend, ghl_created_at, ghl_updated_at, synced_at
    ) VALUES (
      p_org_id, v_op->>'id', NULLIF(v_op->>'contactId', ''),
      NULLIF(v_op->>'pipelineId', ''), NULLIF(v_op->>'pipelineStageId', ''),
      NULLIF(v_op->>'pipelineName', ''), NULLIF(v_op->>'pipelineStageName', ''),
      NULLIF(v_op->>'status', ''), NULLIF(v_op->>'monetaryValue','')::numeric,
      NULLIF(v_op->>'assignedTo', ''), NULLIF(v_op->>'source', ''), NULLIF(v_op->>'name', ''),
      v_cf, v_spend,
      NULLIF(v_op->>'createdAt','')::timestamptz,
      NULLIF(v_op->>'updatedAt','')::timestamptz,
      now()
    )
    ON CONFLICT (org_id, ghl_opportunity_id) DO UPDATE SET
      ghl_contact_id = EXCLUDED.ghl_contact_id,
      pipeline_id = EXCLUDED.pipeline_id, pipeline_stage_id = EXCLUDED.pipeline_stage_id,
      pipeline_name = EXCLUDED.pipeline_name, stage_name = EXCLUDED.stage_name,
      status = EXCLUDED.status, monetary_value = EXCLUDED.monetary_value,
      assigned_to = EXCLUDED.assigned_to, source = EXCLUDED.source, name = EXCLUDED.name,
      custom_fields = EXCLUDED.custom_fields, spend = EXCLUDED.spend,
      ghl_updated_at = EXCLUDED.ghl_updated_at, synced_at = now();
    v_rows := v_rows + 1;
  END LOOP;

  v_next_cur := p_body->'meta'->>'startAfter';
  v_next_id  := p_body->'meta'->>'startAfterId';
  IF v_rows < 100 THEN v_next_cur := NULL; v_next_id := NULL; END IF;

  RETURN jsonb_build_object(
    'rows_synced', v_rows,
    'next_cursor', v_next_cur,
    'next_cursor_id', v_next_id
  );
END $$;
REVOKE ALL ON FUNCTION public._ghl_process_opps_body(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ─── 4. Recreate browser-path RPCs as thin wrappers over the processors ────
CREATE OR REPLACE FUNCTION public.ghl_contacts_sync_page_finish(
  p_org_id UUID, p_request_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_resp RECORD; v_out JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id, status_code, content, error_msg
    INTO v_resp FROM net._http_response WHERE id = p_request_id;
  IF v_resp.id IS NULL THEN RETURN jsonb_build_object('pending', true); END IF;
  IF v_resp.error_msg IS NOT NULL OR v_resp.status_code NOT BETWEEN 200 AND 299 THEN
    RETURN jsonb_build_object('ok', false, 'status', v_resp.status_code,
                              'error', COALESCE(v_resp.error_msg, v_resp.content));
  END IF;
  v_out := public._ghl_process_contacts_body(p_org_id, v_resp.content::jsonb);
  RETURN jsonb_build_object(
    'ok', true,
    'rows_synced',    v_out->>'rows_synced',
    'has_more',       (v_out->>'next_cursor') IS NOT NULL,
    'next_cursor',    v_out->>'next_cursor',
    'next_cursor_id', v_out->>'next_cursor_id'
  );
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_contacts_sync_page_finish(UUID, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ghl_sync_page_finish(
  p_org_id UUID, p_request_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_resp RECORD; v_out JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id, status_code, content, error_msg
    INTO v_resp FROM net._http_response WHERE id = p_request_id;
  IF v_resp.id IS NULL THEN RETURN jsonb_build_object('pending', true); END IF;
  IF v_resp.error_msg IS NOT NULL OR v_resp.status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.organizations
       SET ghl_last_sync_error = format('HTTP %s on opportunities/search: %s',
                                        COALESCE(v_resp.status_code, 0),
                                        COALESCE(v_resp.error_msg, v_resp.content, 'unknown'))
     WHERE id = p_org_id;
    RETURN jsonb_build_object('ok', false, 'status', v_resp.status_code,
                              'error', COALESCE(v_resp.error_msg, v_resp.content));
  END IF;
  v_out := public._ghl_process_opps_body(p_org_id, v_resp.content::jsonb);
  RETURN jsonb_build_object(
    'ok', true,
    'rows_synced',    v_out->>'rows_synced',
    'has_more',       (v_out->>'next_cursor') IS NOT NULL,
    'next_cursor',    v_out->>'next_cursor',
    'next_cursor_id', v_out->>'next_cursor_id'
  );
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_sync_page_finish(UUID, BIGINT) TO authenticated;

-- ─── 5. Internal enrich + finalize (auth-free cores) ───────────────────────
CREATE OR REPLACE FUNCTION public._ghl_enrich_internal(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count INT;
BEGIN
  WITH updated AS (
    UPDATE public.ghl_opportunities o
       SET source = c.source
      FROM public.ghl_contacts c
     WHERE o.org_id = p_org_id AND c.org_id = p_org_id
       AND o.ghl_contact_id = c.ghl_contact_id
       AND (o.source IS DISTINCT FROM c.source)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public._ghl_enrich_internal(UUID) FROM PUBLIC, anon, authenticated;

-- Wrap existing public enrich RPC around the internal core.
CREATE OR REPLACE FUNCTION public.ghl_enrich_opportunities_with_source(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  RETURN public._ghl_enrich_internal(p_org_id);
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_enrich_opportunities_with_source(UUID) TO authenticated;

-- Internal finalize: the v10 cohort logic verbatim, minus the auth check.
-- created_by is auth.uid() — NULL under cron, which kpi_periods allows.
CREATE OR REPLACE FUNCTION public._ghl_finalize_internal(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tags JSONB;
  v_tag_new TEXT; v_tag_net TEXT; v_tag_offer TEXT; v_tag_contract TEXT; v_tag_closed TEXT;
  v_org_channel_names JSONB;
  v_periods INT := 0;
  v_total_won_deals INT := 0;
  v_total_won_rev   NUMERIC(14,2) := 0;
  v_rec RECORD;
  v_existing_channels JSONB;
  v_kept_channels     JSONB;
  v_merged_channels   JSONB;
  v_legacy_patch      JSONB;
BEGIN
  SELECT ghl_funnel_tags INTO v_tags FROM public.organizations WHERE id = p_org_id;
  v_tags := COALESCE(v_tags, '{}'::jsonb);
  v_tag_new      := COALESCE(NULLIF(v_tags->>'newLeads',    ''), 'untouched');
  v_tag_net      := COALESCE(NULLIF(v_tags->>'netLeads',    ''), 'net lead');
  v_tag_offer    := COALESCE(NULLIF(v_tags->>'offers',      ''), 'offer made');
  v_tag_contract := COALESCE(NULLIF(v_tags->>'contracts',   ''), 'under contract');
  v_tag_closed   := COALESCE(NULLIF(v_tags->>'closedDeals', ''), 'closed');

  SELECT COALESCE(jsonb_agg(name), '[]'::jsonb) INTO v_org_channel_names
    FROM public.org_channels WHERE org_id = p_org_id;

  CREATE TEMP TABLE IF NOT EXISTS _contact_channel (
    contact_id    TEXT PRIMARY KEY,
    channel_id    UUID NOT NULL,
    channel_name  TEXT NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _contact_channel;

  WITH
  src_match AS (
    SELECT c.ghl_contact_id, ch.id AS channel_id, ch.name AS channel_name, ch.display_order, 1 AS priority
    FROM public.ghl_contacts c, public.org_channels ch
    WHERE c.org_id = p_org_id AND ch.org_id = p_org_id
      AND c.source IS NOT NULL AND c.source <> ''
      AND ch.source_rules ? 'sources'
      AND ch.source_rules->'sources' @> to_jsonb(c.source)::jsonb
  ),
  tag_match AS (
    SELECT DISTINCT c.ghl_contact_id, ch.id AS channel_id, ch.name AS channel_name, ch.display_order, 2 AS priority
    FROM public.ghl_contacts c
    CROSS JOIN LATERAL jsonb_array_elements_text(c.tags) AS t
    JOIN public.org_channels ch ON ch.org_id = p_org_id
     AND ch.source_rules ? 'tags' AND ch.source_rules->'tags' @> to_jsonb(t)::jsonb
    WHERE c.org_id = p_org_id
  ),
  cf_match AS (
    SELECT DISTINCT c.ghl_contact_id, ch.id AS channel_id, ch.name AS channel_name, ch.display_order, 3 AS priority
    FROM public.ghl_contacts c
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.custom_fields)='array' THEN c.custom_fields ELSE '[]'::jsonb END
    ) AS cf
    JOIN public.org_channels ch ON ch.org_id = p_org_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ch.source_rules->'custom_fields', '[]'::jsonb)) AS rule
    WHERE c.org_id = p_org_id
      AND cf->>'id'    = rule->>'field_id'
      AND cf->>'value' = ANY (SELECT jsonb_array_elements_text(rule->'values'))
  ),
  ranked AS (
    SELECT ghl_contact_id, channel_id, channel_name,
           row_number() OVER (PARTITION BY ghl_contact_id ORDER BY priority, display_order, channel_id) AS rn
    FROM (SELECT * FROM src_match UNION ALL SELECT * FROM tag_match UNION ALL SELECT * FROM cf_match) all_matches
  )
  INSERT INTO _contact_channel (contact_id, channel_id, channel_name)
  SELECT ghl_contact_id, channel_id, channel_name FROM ranked WHERE rn = 1;

  CREATE TEMP TABLE IF NOT EXISTS _funnel (
    period_start    DATE,
    channel_id      UUID,
    channel_name    TEXT,
    new_leads       INT DEFAULT 0,
    net_leads       INT DEFAULT 0,
    offers          INT DEFAULT 0,
    contracts       INT DEFAULT 0,
    closed_deals    INT DEFAULT 0,
    closed_revenue  NUMERIC(14,2) DEFAULT 0,
    PRIMARY KEY (period_start, channel_id)
  ) ON COMMIT DROP;
  TRUNCATE _funnel;

  INSERT INTO _funnel (period_start, channel_id, channel_name,
                       new_leads, net_leads, offers, contracts, closed_deals)
  SELECT period_start, channel_id, channel_name,
         count(*) FILTER (WHERE has_any_funnel_tag),
         count(*) FILTER (WHERE reached_net),
         count(*) FILTER (WHERE reached_offer),
         count(*) FILTER (WHERE reached_contract),
         count(*) FILTER (WHERE reached_closed)
  FROM (
    SELECT
      date_trunc('month', c.ghl_created_at)::date AS period_start,
      cc.channel_id, cc.channel_name,
      (   c.tags @> to_jsonb(v_tag_new)::jsonb OR c.tags @> to_jsonb(v_tag_net)::jsonb
       OR c.tags @> to_jsonb(v_tag_offer)::jsonb OR c.tags @> to_jsonb(v_tag_contract)::jsonb
       OR c.tags @> to_jsonb(v_tag_closed)::jsonb) AS has_any_funnel_tag,
      (   c.tags @> to_jsonb(v_tag_net)::jsonb OR c.tags @> to_jsonb(v_tag_offer)::jsonb
       OR c.tags @> to_jsonb(v_tag_contract)::jsonb OR c.tags @> to_jsonb(v_tag_closed)::jsonb) AS reached_net,
      (   c.tags @> to_jsonb(v_tag_offer)::jsonb OR c.tags @> to_jsonb(v_tag_contract)::jsonb
       OR c.tags @> to_jsonb(v_tag_closed)::jsonb) AS reached_offer,
      (c.tags @> to_jsonb(v_tag_contract)::jsonb OR c.tags @> to_jsonb(v_tag_closed)::jsonb) AS reached_contract,
      (c.tags @> to_jsonb(v_tag_closed)::jsonb)    AS reached_closed
    FROM public.ghl_contacts c
    JOIN _contact_channel cc ON cc.contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id AND c.ghl_created_at IS NOT NULL
  ) cohort
  GROUP BY 1, 2, 3;

  WITH cohort_won AS (
    SELECT date_trunc('month', c.ghl_created_at)::date AS period_start,
           cc.channel_id, sum(o.monetary_value) AS won_rev
    FROM public.ghl_contacts c
    JOIN _contact_channel cc       ON cc.contact_id = c.ghl_contact_id
    JOIN public.ghl_opportunities o ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id AND c.ghl_created_at IS NOT NULL AND o.status = 'won'
    GROUP BY 1, 2
  )
  UPDATE _funnel f SET closed_revenue = COALESCE(cw.won_rev, 0)
    FROM cohort_won cw
   WHERE f.period_start = cw.period_start AND f.channel_id = cw.channel_id;

  FOR v_rec IN
    SELECT period_start,
           jsonb_agg(jsonb_build_object(
             'name',          channel_name,
             'newLeads',      new_leads,
             'netLeads',      net_leads,
             'offers',        offers,
             'contracts',     contracts,
             'closedDeals',   closed_deals,
             'closedRevenue', closed_revenue,
             'source',        'ghl'
           ) ORDER BY channel_name) AS ghl_channels_no_spend,
           sum(closed_deals)   AS month_won,
           sum(closed_revenue) AS month_rev
      FROM _funnel
     WHERE new_leads > 0 OR closed_deals > 0
      GROUP BY period_start
  LOOP
    v_periods := v_periods + 1;
    v_total_won_deals := v_total_won_deals + COALESCE(v_rec.month_won, 0);
    v_total_won_rev   := v_total_won_rev   + COALESCE(v_rec.month_rev, 0);

    SELECT data->'channels' INTO v_existing_channels
      FROM public.kpi_periods WHERE org_id = p_org_id AND period_start = v_rec.period_start;
    IF v_existing_channels IS NULL OR jsonb_typeof(v_existing_channels) <> 'array' THEN
      v_existing_channels := '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(ch), '[]'::jsonb) INTO v_kept_channels
      FROM jsonb_array_elements(v_existing_channels) ch
     WHERE NOT (v_org_channel_names @> jsonb_build_array(ch->>'name'));

    SELECT jsonb_agg(
             ngc || jsonb_build_object(
               'spend',
               COALESCE(
                 (SELECT (ech->>'spend')::numeric
                    FROM jsonb_array_elements(v_existing_channels) ech
                   WHERE ech->>'name' = ngc->>'name' AND (ech->>'spend')::numeric > 0
                   LIMIT 1),
                 (SELECT default_spend FROM public.org_channels
                   WHERE org_id = p_org_id AND name = ngc->>'name'),
                 0
               )
             ) ORDER BY ngc->>'name'
           ) INTO v_merged_channels
    FROM jsonb_array_elements(v_rec.ghl_channels_no_spend) ngc;

    WITH merged AS (
      SELECT row_number() OVER (ORDER BY ch->>'name') AS pos, ch
      FROM jsonb_array_elements(v_merged_channels) ch
    )
    SELECT jsonb_build_object(
      'm1Name',          COALESCE((SELECT ch->>'name'                     FROM merged WHERE pos=1), ''),
      'm1Spend',         COALESCE((SELECT (ch->>'spend')::numeric         FROM merged WHERE pos=1), 0),
      'm1NewLeads',      COALESCE((SELECT (ch->>'newLeads')::int          FROM merged WHERE pos=1), 0),
      'm1NetLeads',      COALESCE((SELECT (ch->>'netLeads')::int          FROM merged WHERE pos=1), 0),
      'm1Offers',        COALESCE((SELECT (ch->>'offers')::int            FROM merged WHERE pos=1), 0),
      'm1Contracts',     COALESCE((SELECT (ch->>'contracts')::int         FROM merged WHERE pos=1), 0),
      'm1ClosedDeals',   COALESCE((SELECT (ch->>'closedDeals')::int       FROM merged WHERE pos=1), 0),
      'm1ClosedRevenue', COALESCE((SELECT (ch->>'closedRevenue')::numeric FROM merged WHERE pos=1), 0),
      'm2Name',          COALESCE((SELECT ch->>'name'                     FROM merged WHERE pos=2), ''),
      'm2Spend',         COALESCE((SELECT (ch->>'spend')::numeric         FROM merged WHERE pos=2), 0),
      'm2NewLeads',      COALESCE((SELECT (ch->>'newLeads')::int          FROM merged WHERE pos=2), 0),
      'm2NetLeads',      COALESCE((SELECT (ch->>'netLeads')::int          FROM merged WHERE pos=2), 0),
      'm2Offers',        COALESCE((SELECT (ch->>'offers')::int            FROM merged WHERE pos=2), 0),
      'm2Contracts',     COALESCE((SELECT (ch->>'contracts')::int         FROM merged WHERE pos=2), 0),
      'm2ClosedDeals',   COALESCE((SELECT (ch->>'closedDeals')::int       FROM merged WHERE pos=2), 0),
      'm2ClosedRevenue', COALESCE((SELECT (ch->>'closedRevenue')::numeric FROM merged WHERE pos=2), 0),
      'm3Name',          COALESCE((SELECT ch->>'name'                     FROM merged WHERE pos=3), ''),
      'm3Spend',         COALESCE((SELECT (ch->>'spend')::numeric         FROM merged WHERE pos=3), 0),
      'm3NewLeads',      COALESCE((SELECT (ch->>'newLeads')::int          FROM merged WHERE pos=3), 0),
      'm3NetLeads',      COALESCE((SELECT (ch->>'netLeads')::int          FROM merged WHERE pos=3), 0),
      'm3Offers',        COALESCE((SELECT (ch->>'offers')::int            FROM merged WHERE pos=3), 0),
      'm3Contracts',     COALESCE((SELECT (ch->>'contracts')::int         FROM merged WHERE pos=3), 0),
      'm3ClosedDeals',   COALESCE((SELECT (ch->>'closedDeals')::int       FROM merged WHERE pos=3), 0),
      'm3ClosedRevenue', COALESCE((SELECT (ch->>'closedRevenue')::numeric FROM merged WHERE pos=3), 0)
    ) INTO v_legacy_patch;

    INSERT INTO public.kpi_periods (org_id, period_start, data, created_by)
    VALUES (p_org_id, v_rec.period_start,
            jsonb_build_object('channels', v_kept_channels || v_merged_channels) || v_legacy_patch,
            auth.uid())
    ON CONFLICT (org_id, period_start) DO UPDATE
       SET data = COALESCE(public.kpi_periods.data, '{}'::jsonb)
                  || jsonb_build_object('channels', v_kept_channels || v_merged_channels)
                  || v_legacy_patch,
           updated_at = now();
  END LOOP;

  UPDATE public.organizations
     SET ghl_last_sync_at = now(), ghl_last_sync_error = NULL,
         ghl_status = CASE WHEN ghl_status = 'error' THEN 'active' ELSE ghl_status END
   WHERE id = p_org_id;

  INSERT INTO public.sync_state (org_id, resource, last_full_sync_at, rows_synced_last_run, updated_at)
  VALUES (p_org_id, 'opportunities', now(), v_total_won_deals, now())
  ON CONFLICT (org_id, resource) DO UPDATE
    SET last_full_sync_at = now(), rows_synced_last_run = EXCLUDED.rows_synced_last_run,
        consecutive_failures = 0, last_error = NULL, last_error_at = NULL, updated_at = now();

  RETURN jsonb_build_object(
    'ok',                 true,
    'model',              'cohort_v10_clean_stale',
    'months_touched',     v_periods,
    'total_won_deals',    v_total_won_deals,
    'total_won_revenue',  v_total_won_rev
  );
END $$;
REVOKE ALL ON FUNCTION public._ghl_finalize_internal(UUID) FROM PUBLIC, anon, authenticated;

-- Public finalize becomes a thin auth-checked wrapper.
CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id UUID, p_pipelines JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  RETURN public._ghl_finalize_internal(p_org_id);
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;

-- ─── 6. Queueing RPCs ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_queue_sync(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_job_id UUID;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  -- Refuse if creds missing — fail fast at queue time, not 10s later in cron.
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.organization_secrets s ON s.org_id = o.id
    WHERE o.id = p_org_id AND o.ghl_location_id IS NOT NULL AND s.ghl_pit_token IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'org has no saved GHL credentials';
  END IF;

  -- One active job per org; return the existing one if already queued/running.
  SELECT id INTO v_job_id FROM public.ghl_sync_jobs
   WHERE org_id = p_org_id AND status IN ('queued','running');
  IF v_job_id IS NOT NULL THEN RETURN v_job_id; END IF;

  INSERT INTO public.ghl_sync_jobs (org_id, triggered_by)
  VALUES (p_org_id, 'manual')
  RETURNING id INTO v_job_id;
  RETURN v_job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_queue_sync(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ghl_enqueue_nightly()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count INT;
BEGIN
  WITH eligible AS (
    SELECT o.id
    FROM public.organizations o
    JOIN public.organization_secrets s ON s.org_id = o.id
    WHERE o.ghl_status = 'active'
      AND o.ghl_location_id IS NOT NULL
      AND s.ghl_pit_token IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ghl_sync_jobs j
        WHERE j.org_id = o.id AND j.status IN ('queued','running')
      )
  ), inserted AS (
    INSERT INTO public.ghl_sync_jobs (org_id, triggered_by)
    SELECT id, 'nightly' FROM eligible
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.ghl_enqueue_nightly() FROM PUBLIC, anon, authenticated;

-- ─── 7. The cron tick: advance every active job by one step ────────────────
CREATE OR REPLACE FUNCTION public.ghl_cron_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_job   RECORD;
  v_resp  RECORD;
  v_out   JSONB;
  v_next_pipeline TEXT;
  v_req   BIGINT;
  v_advanced INT := 0;
  v_summary JSONB;
BEGIN
  FOR v_job IN
    SELECT j.*, o.ghl_selected_pipeline_ids
      FROM public.ghl_sync_jobs j
      JOIN public.organizations o ON o.id = j.org_id
     WHERE j.status IN ('queued','running')
     ORDER BY j.queued_at
     LIMIT 10
     FOR UPDATE OF j SKIP LOCKED   -- overlapping ticks must not double-process a job
  LOOP
    BEGIN  -- per-job error isolation: one broken job must not stall the rest

      IF v_job.status = 'queued' THEN
        v_req := public._ghl_dispatch_contacts_page(v_job.org_id, NULL, NULL);
        UPDATE public.ghl_sync_jobs
           SET status = 'running', phase = 'contacts',
               pipeline_queue = COALESCE(v_job.ghl_selected_pipeline_ids, '{}'),
               in_flight_request_id = v_req, started_at = now(), error = NULL
         WHERE id = v_job.id;
        v_advanced := v_advanced + 1;
        CONTINUE;
      END IF;

      -- running: is the in-flight response here yet?
      SELECT id, status_code, content, error_msg
        INTO v_resp FROM net._http_response
       WHERE id = v_job.in_flight_request_id;
      IF v_resp.id IS NULL THEN CONTINUE; END IF;  -- still in flight

      -- HTTP failure → retry same page up to 3 times, then error the job.
      IF v_resp.error_msg IS NOT NULL OR v_resp.status_code NOT BETWEEN 200 AND 299 THEN
        IF v_job.retry_count >= 3 THEN
          UPDATE public.ghl_sync_jobs
             SET status = 'error', finished_at = now(),
                 error = format('HTTP %s after %s retries (%s phase): %s',
                                COALESCE(v_resp.status_code, 0), v_job.retry_count,
                                v_job.phase, COALESCE(v_resp.error_msg, left(v_resp.content, 300)))
           WHERE id = v_job.id;
          UPDATE public.organizations
             SET ghl_last_sync_error = format('nightly sync failed in %s phase: HTTP %s',
                                              v_job.phase, COALESCE(v_resp.status_code, 0))
           WHERE id = v_job.org_id;
          UPDATE public.sync_state
             SET consecutive_failures = consecutive_failures + 1,
                 last_error = format('HTTP %s in %s phase', COALESCE(v_resp.status_code,0), v_job.phase),
                 last_error_at = now(), updated_at = now()
           WHERE org_id = v_job.org_id AND resource = 'opportunities';
        ELSE
          -- Re-dispatch the same page.
          IF v_job.phase = 'contacts' THEN
            v_req := public._ghl_dispatch_contacts_page(v_job.org_id, v_job.cursor, v_job.cursor_id);
          ELSE
            v_req := public._ghl_dispatch_opps_page(v_job.org_id, v_job.current_pipeline, v_job.cursor, v_job.cursor_id);
          END IF;
          UPDATE public.ghl_sync_jobs
             SET retry_count = retry_count + 1, in_flight_request_id = v_req
           WHERE id = v_job.id;
        END IF;
        v_advanced := v_advanced + 1;
        CONTINUE;
      END IF;

      -- Success: process according to phase.
      IF v_job.phase = 'contacts' THEN
        v_out := public._ghl_process_contacts_body(v_job.org_id, v_resp.content::jsonb);
        IF (v_out->>'next_cursor') IS NOT NULL THEN
          v_req := public._ghl_dispatch_contacts_page(
            v_job.org_id, v_out->>'next_cursor', v_out->>'next_cursor_id');
          UPDATE public.ghl_sync_jobs
             SET rows_contacts = rows_contacts + (v_out->>'rows_synced')::int,
                 cursor = v_out->>'next_cursor', cursor_id = v_out->>'next_cursor_id',
                 in_flight_request_id = v_req, retry_count = 0
           WHERE id = v_job.id;
        ELSE
          -- Contacts done → start opportunities (or finalize if no pipelines).
          IF COALESCE(array_length(v_job.pipeline_queue, 1), 0) = 0 THEN
            PERFORM public._ghl_enrich_internal(v_job.org_id);
            v_summary := public._ghl_finalize_internal(v_job.org_id);
            UPDATE public.ghl_sync_jobs
               SET rows_contacts = rows_contacts + (v_out->>'rows_synced')::int,
                   status = 'done', phase = 'finalizing', result = v_summary,
                   finished_at = now(), in_flight_request_id = NULL
             WHERE id = v_job.id;
          ELSE
            v_next_pipeline := v_job.pipeline_queue[1];
            v_req := public._ghl_dispatch_opps_page(v_job.org_id, v_next_pipeline, NULL, NULL);
            UPDATE public.ghl_sync_jobs
               SET rows_contacts = rows_contacts + (v_out->>'rows_synced')::int,
                   phase = 'opportunities',
                   current_pipeline = v_next_pipeline,
                   pipeline_queue = v_job.pipeline_queue[2:],
                   cursor = NULL, cursor_id = NULL,
                   in_flight_request_id = v_req, retry_count = 0
             WHERE id = v_job.id;
          END IF;
        END IF;

      ELSIF v_job.phase = 'opportunities' THEN
        v_out := public._ghl_process_opps_body(v_job.org_id, v_resp.content::jsonb);
        IF (v_out->>'next_cursor') IS NOT NULL THEN
          v_req := public._ghl_dispatch_opps_page(
            v_job.org_id, v_job.current_pipeline, v_out->>'next_cursor', v_out->>'next_cursor_id');
          UPDATE public.ghl_sync_jobs
             SET rows_opportunities = rows_opportunities + (v_out->>'rows_synced')::int,
                 cursor = v_out->>'next_cursor', cursor_id = v_out->>'next_cursor_id',
                 in_flight_request_id = v_req, retry_count = 0
           WHERE id = v_job.id;
        ELSIF COALESCE(array_length(v_job.pipeline_queue, 1), 0) > 0 THEN
          v_next_pipeline := v_job.pipeline_queue[1];
          v_req := public._ghl_dispatch_opps_page(v_job.org_id, v_next_pipeline, NULL, NULL);
          UPDATE public.ghl_sync_jobs
             SET rows_opportunities = rows_opportunities + (v_out->>'rows_synced')::int,
                 current_pipeline = v_next_pipeline,
                 pipeline_queue = v_job.pipeline_queue[2:],
                 cursor = NULL, cursor_id = NULL,
                 in_flight_request_id = v_req, retry_count = 0
           WHERE id = v_job.id;
        ELSE
          -- All pipelines drained → enrich + finalize → done.
          PERFORM public._ghl_enrich_internal(v_job.org_id);
          v_summary := public._ghl_finalize_internal(v_job.org_id);
          UPDATE public.ghl_sync_jobs
             SET rows_opportunities = rows_opportunities + (v_out->>'rows_synced')::int,
                 status = 'done', phase = 'finalizing', result = v_summary,
                 finished_at = now(), in_flight_request_id = NULL
           WHERE id = v_job.id;
        END IF;
      END IF;

      v_advanced := v_advanced + 1;

    EXCEPTION WHEN others THEN
      UPDATE public.ghl_sync_jobs
         SET status = 'error', error = 'tick exception: ' || SQLERRM, finished_at = now()
       WHERE id = v_job.id;
    END;
  END LOOP;

  RETURN jsonb_build_object('advanced', v_advanced);
END $$;
REVOKE ALL ON FUNCTION public.ghl_cron_tick() FROM PUBLIC, anon, authenticated;

-- ─── 8. Schedules (idempotent: same jobname replaces) ──────────────────────
-- Guarded: only schedule when pg_cron is actually installed. On the
-- single-container VPS (plain debian Postgres) pg_cron/pg_net aren't present
-- yet, so this migration must replay cleanly without them — it creates the
-- tables/functions (dormant) and skips scheduling. Once pg_cron is added to
-- that image and this migration replays, the jobs get created then.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('ghl-sync-tick',        '10 seconds', 'SELECT public.ghl_cron_tick()');
    PERFORM cron.schedule('ghl-nightly-enqueue',  '0 2 * * *',  'SELECT public.ghl_enqueue_nightly()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — GHL sync schedules skipped (tables/functions still created)';
  END IF;
END $$;
