-- ============================================================================
-- Simplify ghl_sync_finalize: drop per-channel pipeline stage mapping.
--
-- The previous version forced admins to pick which pipeline stages count as
-- net lead / offer / contract per channel. In practice most pipelines aren't
-- sales-funnel-shaped (they're exit strategy, disposition, transaction
-- coordination). And pipelines are shared across channels — it doesn't make
-- sense to map them per channel.
--
-- New behavior: each channel only needs source rules. We compute:
--   newLeads      = contacts created in month matching the channel's source rules
--   closedDeals   = opps from those contacts with status='won', updated in month
--   closedRevenue = sum(monetary_value) of those won opps
--   spend         = channel's default_spend
--   netLeads / offers / contracts → 0 (not computed; out of scope for v1)
-- ============================================================================

DROP FUNCTION IF EXISTS public.ghl_sync_finalize(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id    UUID,
  p_pipelines JSONB DEFAULT NULL  -- kept for API compat; unused
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_periods           INT := 0;
  v_total_won_deals   INT := 0;
  v_total_won_rev     NUMERIC(14,2) := 0;
  v_rec               RECORD;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  -- ─── Step 1: Build (contact_id → channel_id) lookup from source rules ──
  CREATE TEMP TABLE IF NOT EXISTS _contact_channel (
    contact_id    TEXT PRIMARY KEY,
    channel_id    UUID NOT NULL,
    channel_name  TEXT NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _contact_channel;

  WITH
  -- Contact matches a channel by source field
  src_match AS (
    SELECT c.ghl_contact_id, ch.id AS channel_id, ch.name AS channel_name, ch.display_order, 1 AS priority
    FROM public.ghl_contacts c, public.org_channels ch
    WHERE c.org_id = p_org_id AND ch.org_id = p_org_id
      AND c.source IS NOT NULL AND c.source <> ''
      AND ch.source_rules ? 'sources'
      AND ch.source_rules->'sources' @> to_jsonb(c.source)::jsonb
  ),
  -- Contact matches if ANY tag is in channel.source_rules.tags
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
  -- Contact matches if any (field_id, value) pair is in channel.source_rules.custom_fields
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
  -- For contacts matching multiple channels, pick the first by priority then display_order.
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

  -- ─── Step 2: Per (month, channel) aggregate ──────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS _funnel (
    period_start    DATE,
    channel_id      UUID,
    channel_name    TEXT,
    new_leads       INT,
    closed_deals    INT,
    closed_revenue  NUMERIC(14,2),
    spend           NUMERIC(14,2),
    PRIMARY KEY (period_start, channel_id)
  ) ON COMMIT DROP;
  TRUNCATE _funnel;

  -- newLeads
  INSERT INTO _funnel (period_start, channel_id, channel_name, new_leads, closed_deals, closed_revenue, spend)
  SELECT
    date_trunc('month', c.ghl_created_at)::date,
    cc.channel_id, cc.channel_name,
    count(*), 0, 0, 0
  FROM public.ghl_contacts c
  JOIN _contact_channel cc ON cc.contact_id = c.ghl_contact_id
  WHERE c.org_id = p_org_id AND c.ghl_created_at IS NOT NULL
  GROUP BY 1, 2, 3
  ON CONFLICT (period_start, channel_id) DO UPDATE
    SET new_leads = EXCLUDED.new_leads;

  -- closedDeals + closedRevenue (status='won' opps)
  INSERT INTO _funnel (period_start, channel_id, channel_name, new_leads, closed_deals, closed_revenue, spend)
  SELECT
    date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at))::date,
    cc.channel_id, cc.channel_name,
    0,
    count(*),
    COALESCE(sum(o.monetary_value), 0),
    0
  FROM public.ghl_opportunities o
  JOIN _contact_channel cc ON cc.contact_id = o.ghl_contact_id
  WHERE o.org_id = p_org_id
    AND o.status = 'won'
    AND COALESCE(o.ghl_updated_at, o.ghl_created_at) IS NOT NULL
  GROUP BY 1, 2, 3
  ON CONFLICT (period_start, channel_id) DO UPDATE
    SET closed_deals   = EXCLUDED.closed_deals,
        closed_revenue = EXCLUDED.closed_revenue;

  -- Default spend
  UPDATE _funnel f SET spend = ch.default_spend
    FROM public.org_channels ch
   WHERE ch.id = f.channel_id AND ch.default_spend > 0;

  -- ─── Step 3: Upsert kpi_periods per month ──────────────────────────
  FOR v_rec IN
    SELECT period_start,
           jsonb_agg(jsonb_build_object(
             'name',          channel_name,
             'newLeads',      new_leads,
             'netLeads',      0,
             'offers',        0,
             'contracts',     0,
             'closedDeals',   closed_deals,
             'closedRevenue', closed_revenue,
             'spend',         spend,
             'source',        'ghl'
           ) ORDER BY channel_name) AS ghl_channels,
           sum(closed_deals) AS month_won,
           sum(closed_revenue) AS month_rev
      FROM _funnel
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
    'months_touched',     v_periods,
    'total_won_deals',    v_total_won_deals,
    'total_won_revenue',  v_total_won_rev
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;
