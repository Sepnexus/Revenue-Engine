-- ============================================================================
-- Replacement for ghl_sync_finalize. The right model:
--
--   For each WON opportunity:
--     month = date_trunc('month', opp.ghl_updated_at)         ← close month
--     channel = ghl_source_mapping[contact.source] or 'Other / Unmapped'
--     revenue = opp.monetary_value
--
--   Aggregate by (month, channel) → write per-month kpi_periods rows where
--   data.channels[] gets one entry per channel with:
--     { name, closedDeals, closedRevenue, newLeads, netLeads, offers,
--       contracts, spend, source: 'ghl' }
--
-- Where channels[] in kpi_periods.data is the same field the existing
-- dashboard already reads, so revenue/profit/ROI charts populate
-- automatically without any further UI changes.
--
-- p_pipelines (optional) is still accepted to fill in pipeline/stage names
-- for the *also-still-written* data.ghl_channel diagnostic block.
-- ============================================================================

DROP FUNCTION IF EXISTS public.ghl_sync_finalize(UUID);
DROP FUNCTION IF EXISTS public.ghl_sync_finalize(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id    UUID,
  p_pipelines JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mapping      JSONB;
  v_periods_touched INT := 0;
  v_total_won_revenue NUMERIC(14,2) := 0;
  v_total_won_count   INT := 0;
  v_months_summary    JSONB := '[]'::jsonb;
  v_rec               RECORD;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT ghl_source_mapping INTO v_mapping
    FROM public.organizations WHERE id = p_org_id;
  v_mapping := COALESCE(v_mapping, '{}'::jsonb);

  -- ─── Aggregate WON opportunities by close-month + channel ─────────────
  -- channel = mapping[source]  (fall back to "Other / Unmapped")
  CREATE TEMP TABLE IF NOT EXISTS _ghl_month_channel (
    period_start    DATE,
    channel         TEXT,
    closed_deals    INT,
    closed_revenue  NUMERIC(14,2),
    total_spend     NUMERIC(14,2),
    PRIMARY KEY (period_start, channel)
  ) ON COMMIT DROP;
  TRUNCATE _ghl_month_channel;

  INSERT INTO _ghl_month_channel (period_start, channel, closed_deals, closed_revenue, total_spend)
  SELECT
    date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at, now()))::date AS period_start,
    COALESCE(
      NULLIF(v_mapping->>(COALESCE(o.source, '(no source)')), ''),
      'Other / Unmapped'
    ) AS channel,
    count(*) AS closed_deals,
    COALESCE(sum(o.monetary_value), 0) AS closed_revenue,
    COALESCE(sum(o.spend), 0) AS total_spend
  FROM public.ghl_opportunities o
  WHERE o.org_id = p_org_id
    AND o.status = 'won'
    AND o.ghl_updated_at IS NOT NULL
  GROUP BY 1, 2;

  SELECT
    count(DISTINCT period_start),
    COALESCE(sum(closed_revenue), 0),
    COALESCE(sum(closed_deals), 0)
  INTO v_periods_touched, v_total_won_revenue, v_total_won_count
  FROM _ghl_month_channel;

  -- ─── Upsert kpi_periods per month, writing channels[] entries ───────────
  -- Existing data is preserved; we only modify channels that were sourced
  -- from GHL (marked with source='ghl'). Manual channels stay untouched.
  FOR v_rec IN
    SELECT period_start,
           jsonb_agg(jsonb_build_object(
             'name',          channel,
             'closedDeals',   closed_deals,
             'closedRevenue', closed_revenue,
             'spend',         total_spend,
             'source',        'ghl',
             -- Funnel fields not derivable from won-only filter; leave 0 for now.
             'newLeads',      0,
             'netLeads',      0,
             'offers',        0,
             'contracts',     closed_deals
           )) AS ghl_channels
      FROM _ghl_month_channel
      GROUP BY period_start
  LOOP
    -- Merge: keep all NON-ghl channels in the existing row, add the new ghl ones.
    INSERT INTO public.kpi_periods (org_id, period_start, data, created_by)
    VALUES (
      p_org_id,
      v_rec.period_start,
      jsonb_build_object('channels', v_rec.ghl_channels),
      auth.uid()
    )
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

    v_months_summary := v_months_summary || jsonb_build_array(jsonb_build_object(
      'period_start',  v_rec.period_start,
      'channels_count', jsonb_array_length(v_rec.ghl_channels)
    ));
  END LOOP;

  -- ─── Org-level sync metadata ─────────────────────────────────────────────
  UPDATE public.organizations
     SET ghl_last_sync_at    = now(),
         ghl_last_sync_error = NULL,
         ghl_status          = CASE WHEN ghl_status = 'error' THEN 'active' ELSE ghl_status END
   WHERE id = p_org_id;

  INSERT INTO public.sync_state (org_id, resource, last_full_sync_at, rows_synced_last_run, updated_at)
  VALUES (p_org_id, 'opportunities', now(), v_total_won_count, now())
  ON CONFLICT (org_id, resource) DO UPDATE
    SET last_full_sync_at    = now(),
        rows_synced_last_run = EXCLUDED.rows_synced_last_run,
        consecutive_failures = 0,
        last_error           = NULL,
        last_error_at        = NULL,
        updated_at           = now();

  RETURN jsonb_build_object(
    'ok',                  true,
    'months_touched',      v_periods_touched,
    'total_won_deals',     v_total_won_count,
    'total_won_revenue',   v_total_won_revenue,
    'months_summary',      v_months_summary
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;
