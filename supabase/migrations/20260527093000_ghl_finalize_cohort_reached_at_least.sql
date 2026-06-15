-- ============================================================================
-- ghl_sync_finalize v7: cohort funnel with "reached at least this stage".
--
-- Reality: iBuyKC's CRM mostly REPLACES funnel tags as contacts move
-- (untouched → net lead removes untouched). Strict tag-presence counting
-- treats stages as mutually-exclusive snapshots — no funnel.
--
-- Correct model: a contact carrying a later-stage tag has IMPLICITLY
-- reached all earlier stages. So:
--
--   reached "new lead"  ← any funnel tag       (any of the 5)
--   reached "net lead"  ← net OR offer OR contract OR closed
--   reached "offer"     ← offer OR contract OR closed
--   reached "contract"  ← contract OR closed
--   reached "closed"    ← closed
--
-- Cohort = contacts CREATED in month + matched to channel + has any funnel
-- tag (so we exclude non-lead contacts like vendors/agents).
--
-- Result: newLeads ≥ netLeads ≥ offers ≥ contracts ≥ closedDeals — always.
-- Lead-to-X conversion = X / newLeads ≤ 100%.
-- ============================================================================

DROP FUNCTION IF EXISTS public.ghl_sync_finalize(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id    UUID,
  p_pipelines JSONB DEFAULT NULL  -- unused, kept for API compat
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tags JSONB;
  v_tag_new      TEXT;
  v_tag_net      TEXT;
  v_tag_offer    TEXT;
  v_tag_contract TEXT;
  v_tag_closed   TEXT;
  v_periods         INT := 0;
  v_total_won_deals INT := 0;
  v_total_won_rev   NUMERIC(14,2) := 0;
  v_rec             RECORD;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT ghl_funnel_tags INTO v_tags FROM public.organizations WHERE id = p_org_id;
  v_tags := COALESCE(v_tags, '{}'::jsonb);
  v_tag_new      := COALESCE(NULLIF(v_tags->>'newLeads',    ''), 'untouched');
  v_tag_net      := COALESCE(NULLIF(v_tags->>'netLeads',    ''), 'net lead');
  v_tag_offer    := COALESCE(NULLIF(v_tags->>'offers',      ''), 'offer made');
  v_tag_contract := COALESCE(NULLIF(v_tags->>'contracts',   ''), 'under contract');
  v_tag_closed   := COALESCE(NULLIF(v_tags->>'closedDeals', ''), 'closed');

  -- ─── (contact → channel) lookup ─────────────────────────────────────────
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
    JOIN public.org_channels ch
      ON ch.org_id = p_org_id
     AND ch.source_rules ? 'tags'
     AND ch.source_rules->'tags' @> to_jsonb(t)::jsonb
    WHERE c.org_id = p_org_id
  ),
  cf_match AS (
    SELECT DISTINCT c.ghl_contact_id, ch.id AS channel_id, ch.name AS channel_name, ch.display_order, 3 AS priority
    FROM public.ghl_contacts c
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.custom_fields)='array' THEN c.custom_fields ELSE '[]'::jsonb END
    ) AS cf
    JOIN public.org_channels ch ON ch.org_id = p_org_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(ch.source_rules->'custom_fields', '[]'::jsonb)
    ) AS rule
    WHERE c.org_id = p_org_id
      AND cf->>'id'    = rule->>'field_id'
      AND cf->>'value' = ANY (SELECT jsonb_array_elements_text(rule->'values'))
  ),
  ranked AS (
    SELECT ghl_contact_id, channel_id, channel_name,
           row_number() OVER (
             PARTITION BY ghl_contact_id
             ORDER BY priority, display_order, channel_id
           ) AS rn
    FROM (
      SELECT * FROM src_match
      UNION ALL SELECT * FROM tag_match
      UNION ALL SELECT * FROM cf_match
    ) all_matches
  )
  INSERT INTO _contact_channel (contact_id, channel_id, channel_name)
  SELECT ghl_contact_id, channel_id, channel_name FROM ranked WHERE rn = 1;

  -- ─── Cohort funnel: "reached at least this stage" ─────────────────────
  -- For each contact in the cohort we compute 5 boolean flags
  -- (reached_new / reached_net / reached_offer / reached_contract /
  -- reached_closed) using "tag ∈ {this stage or any later}" logic. Then
  -- COUNT per (channel, month).
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
    spend           NUMERIC(14,2) DEFAULT 0,
    PRIMARY KEY (period_start, channel_id)
  ) ON COMMIT DROP;
  TRUNCATE _funnel;

  INSERT INTO _funnel (period_start, channel_id, channel_name,
                       new_leads, net_leads, offers, contracts, closed_deals)
  SELECT
    period_start, channel_id, channel_name,
    count(*) FILTER (WHERE has_any_funnel_tag) AS new_leads,
    count(*) FILTER (WHERE reached_net)        AS net_leads,
    count(*) FILTER (WHERE reached_offer)      AS offers,
    count(*) FILTER (WHERE reached_contract)   AS contracts,
    count(*) FILTER (WHERE reached_closed)     AS closed_deals
  FROM (
    SELECT
      date_trunc('month', c.ghl_created_at)::date AS period_start,
      cc.channel_id,
      cc.channel_name,
      -- "has any funnel tag" = was treated as a lead at some point
      (   c.tags @> to_jsonb(v_tag_new)::jsonb
       OR c.tags @> to_jsonb(v_tag_net)::jsonb
       OR c.tags @> to_jsonb(v_tag_offer)::jsonb
       OR c.tags @> to_jsonb(v_tag_contract)::jsonb
       OR c.tags @> to_jsonb(v_tag_closed)::jsonb
      ) AS has_any_funnel_tag,
      -- Reached "net lead" = currently has net/offer/contract/closed
      (   c.tags @> to_jsonb(v_tag_net)::jsonb
       OR c.tags @> to_jsonb(v_tag_offer)::jsonb
       OR c.tags @> to_jsonb(v_tag_contract)::jsonb
       OR c.tags @> to_jsonb(v_tag_closed)::jsonb
      ) AS reached_net,
      -- Reached "offer" = currently has offer/contract/closed
      (   c.tags @> to_jsonb(v_tag_offer)::jsonb
       OR c.tags @> to_jsonb(v_tag_contract)::jsonb
       OR c.tags @> to_jsonb(v_tag_closed)::jsonb
      ) AS reached_offer,
      -- Reached "contract" = currently has contract/closed
      (   c.tags @> to_jsonb(v_tag_contract)::jsonb
       OR c.tags @> to_jsonb(v_tag_closed)::jsonb
      ) AS reached_contract,
      -- Reached "closed" = closed tag
      (c.tags @> to_jsonb(v_tag_closed)::jsonb) AS reached_closed
    FROM public.ghl_contacts c
    JOIN _contact_channel cc ON cc.contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id
      AND c.ghl_created_at IS NOT NULL
  ) cohort
  GROUP BY 1, 2, 3;

  -- closedRevenue: sum of WON opps' monetary_value, attributed to the cohort
  -- contact's creation month (not the opp's close month).
  WITH cohort_won AS (
    SELECT
      date_trunc('month', c.ghl_created_at)::date AS period_start,
      cc.channel_id,
      sum(o.monetary_value) AS won_rev
    FROM public.ghl_contacts c
    JOIN _contact_channel cc       ON cc.contact_id = c.ghl_contact_id
    JOIN public.ghl_opportunities o ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id
      AND c.ghl_created_at IS NOT NULL
      AND o.status = 'won'
    GROUP BY 1, 2
  )
  UPDATE _funnel f
     SET closed_revenue = COALESCE(cw.won_rev, 0)
    FROM cohort_won cw
   WHERE f.period_start = cw.period_start AND f.channel_id = cw.channel_id;

  UPDATE _funnel f SET spend = ch.default_spend
    FROM public.org_channels ch
   WHERE ch.id = f.channel_id AND ch.default_spend > 0;

  -- ─── Per-month kpi_periods upsert ────────────────────────────────────
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
             'spend',         spend,
             'source',        'ghl'
           ) ORDER BY channel_name) AS ghl_channels,
           sum(closed_deals)   AS month_won,
           sum(closed_revenue) AS month_rev
      FROM _funnel
     WHERE new_leads > 0 OR closed_deals > 0   -- drop empty (channel, month) rows
      GROUP BY period_start
  LOOP
    v_periods := v_periods + 1;
    v_total_won_deals := v_total_won_deals + COALESCE(v_rec.month_won, 0);
    v_total_won_rev   := v_total_won_rev   + COALESCE(v_rec.month_rev, 0);

    INSERT INTO public.kpi_periods (org_id, period_start, data, created_by)
    VALUES (p_org_id, v_rec.period_start, jsonb_build_object('channels', v_rec.ghl_channels), auth.uid())
    ON CONFLICT (org_id, period_start) DO UPDATE
       SET data = COALESCE(public.kpi_periods.data, '{}'::jsonb) || jsonb_build_object(
             'channels',
             COALESCE(
               (
                 SELECT jsonb_agg(ch)
                 FROM jsonb_array_elements(public.kpi_periods.data->'channels') ch
                 WHERE ch->>'source' IS DISTINCT FROM 'ghl'
               ), '[]'::jsonb
             ) || v_rec.ghl_channels
           ),
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
    'model',              'cohort_reached_at_least',
    'months_touched',     v_periods,
    'total_won_deals',    v_total_won_deals,
    'total_won_revenue',  v_total_won_rev,
    'funnel_tags_used',   v_tags
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;
