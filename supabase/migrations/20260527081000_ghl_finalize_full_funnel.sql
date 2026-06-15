-- ============================================================================
-- ghl_sync_finalize v4: iterates org_channels and computes the FULL funnel
-- per channel × per month.
--
--   For each (channel, month):
--     newLeads      = count(contacts created in month whose source/tag/cf
--                     matches channel.source_rules)
--     netLeads      = count(opps from those contacts whose pipeline_stage_id
--                     ∈ channel.net_stage_ids AND opp updated in month)
--     offers        = count(opps whose stage ∈ offer_stage_ids AND updated in month)
--     contracts     = count(opps whose stage ∈ contract_stage_ids AND updated in month)
--     closedDeals   = count(opps WHERE status='won' AND updated in month)
--     closedRevenue = sum(monetary_value) of the above
--     spend         = COALESCE(manual override, channel.default_spend, 0)
--
-- Source matching rule for a contact → channel:
--   contact matches channel iff
--     contact.source         ∈ channel.source_rules.sources, OR
--     any contact.tag        ∈ channel.source_rules.tags,    OR
--     any custom-field value where (field_id, value) ∈ channel.source_rules.custom_fields
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
  v_unmapped_default TEXT := 'Other / Unmapped';
  v_periods INT := 0;
  v_total_won_deals INT := 0;
  v_total_won_rev NUMERIC(14,2) := 0;
  v_rec RECORD;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  -- ─── Step 1: Build a (contact_id → channel_id) lookup based on rules ──
  CREATE TEMP TABLE IF NOT EXISTS _contact_channel (
    contact_id TEXT PRIMARY KEY,
    channel_id UUID NOT NULL,
    channel_name TEXT NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _contact_channel;

  WITH src_match AS (
    -- Contact matches by source field
    SELECT c.ghl_contact_id, ch.id AS channel_id, ch.name AS channel_name, ch.display_order, 1 AS priority
    FROM public.ghl_contacts c, public.org_channels ch
    WHERE c.org_id = p_org_id AND ch.org_id = p_org_id
      AND c.source IS NOT NULL AND c.source <> ''
      AND ch.source_rules ? 'sources'
      AND ch.source_rules->'sources' @> to_jsonb(c.source)::jsonb
  ),
  tag_match AS (
    -- Contact matches if ANY tag is in channel.source_rules.tags
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
    -- Contact matches if any (field_id, value) pair appears in channel.source_rules.custom_fields
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
      AND cf->>'value' = ANY (
        SELECT jsonb_array_elements_text(rule->'values')
      )
  ),
  ranked AS (
    SELECT ghl_contact_id, channel_id, channel_name, display_order, priority,
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

  -- ─── Step 2: For each (channel, month), compute the funnel metrics ──
  CREATE TEMP TABLE IF NOT EXISTS _funnel (
    period_start    DATE,
    channel_id      UUID,
    channel_name    TEXT,
    new_leads       INT,
    net_leads       INT,
    offers          INT,
    contracts       INT,
    closed_deals    INT,
    closed_revenue  NUMERIC(14,2),
    spend           NUMERIC(14,2),
    PRIMARY KEY (period_start, channel_id)
  ) ON COMMIT DROP;
  TRUNCATE _funnel;

  -- newLeads: contacts created in month, grouped by channel
  INSERT INTO _funnel (period_start, channel_id, channel_name, new_leads, net_leads, offers, contracts, closed_deals, closed_revenue, spend)
  SELECT
    date_trunc('month', c.ghl_created_at)::date,
    cc.channel_id, cc.channel_name,
    count(*), 0, 0, 0, 0, 0, 0
  FROM public.ghl_contacts c
  JOIN _contact_channel cc ON cc.contact_id = c.ghl_contact_id
  WHERE c.org_id = p_org_id AND c.ghl_created_at IS NOT NULL
  GROUP BY 1, 2, 3
  ON CONFLICT (period_start, channel_id) DO UPDATE
    SET new_leads = EXCLUDED.new_leads;

  -- netLeads, offers, contracts, closedDeals/revenue: from opportunities
  WITH opp_per_channel_month AS (
    SELECT
      date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at))::date AS period_start,
      cc.channel_id,
      cc.channel_name,
      o.pipeline_stage_id,
      o.status,
      o.monetary_value,
      ch.net_stage_ids,
      ch.offer_stage_ids,
      ch.contract_stage_ids
    FROM public.ghl_opportunities o
    JOIN _contact_channel cc ON cc.contact_id = o.ghl_contact_id
    JOIN public.org_channels ch ON ch.id = cc.channel_id
    WHERE o.org_id = p_org_id
      AND COALESCE(o.ghl_updated_at, o.ghl_created_at) IS NOT NULL
  ),
  agg AS (
    SELECT
      period_start, channel_id, max(channel_name) AS channel_name,
      count(*) FILTER (WHERE pipeline_stage_id = ANY (net_stage_ids))      AS net_leads,
      count(*) FILTER (WHERE pipeline_stage_id = ANY (offer_stage_ids))    AS offers,
      count(*) FILTER (WHERE pipeline_stage_id = ANY (contract_stage_ids)) AS contracts,
      count(*) FILTER (WHERE status = 'won')                                AS closed_deals,
      COALESCE(sum(monetary_value) FILTER (WHERE status = 'won'), 0)        AS closed_revenue
    FROM opp_per_channel_month
    GROUP BY 1, 2
  )
  INSERT INTO _funnel (period_start, channel_id, channel_name, new_leads, net_leads, offers, contracts, closed_deals, closed_revenue, spend)
  SELECT period_start, channel_id, channel_name, 0, net_leads, offers, contracts, closed_deals, closed_revenue, 0
  FROM agg
  ON CONFLICT (period_start, channel_id) DO UPDATE
    SET net_leads     = EXCLUDED.net_leads,
        offers        = EXCLUDED.offers,
        contracts     = EXCLUDED.contracts,
        closed_deals  = EXCLUDED.closed_deals,
        closed_revenue= EXCLUDED.closed_revenue;

  -- Fill in default spend per channel into every row that has any activity
  UPDATE _funnel f SET spend = ch.default_spend
    FROM public.org_channels ch
   WHERE ch.id = f.channel_id AND ch.default_spend > 0;

  -- ─── Step 3: Per-month upsert into kpi_periods.data.channels[] ──────
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
           sum(closed_deals)    AS month_won,
           sum(closed_revenue)  AS month_rev
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
    'total_won_revenue',  v_total_won_rev,
    'channels_active',    (SELECT count(*) FROM _funnel WHERE channel_id IS NOT NULL)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;
