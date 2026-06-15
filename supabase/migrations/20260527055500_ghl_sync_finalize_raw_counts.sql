-- ============================================================================
-- Redesign of ghl_sync_finalize: drop the forced Contact/Net/Offer/Contract
-- mapping and instead aggregate raw opportunity counts by stage NAME across
-- every selected pipeline.
--
-- Why: most clients' GHL pipelines don't fit a clean 4-step funnel
-- (e.g. Blast/Interested/Neutral/Never Inquired is an outreach-response
-- shape, not a sales funnel). Forcing the mapping made admins guess at
-- semantics and produced useless zeros. Raw stage counts are honest and
-- always meaningful.
--
-- New output shape written to kpi_periods.data.ghl_channel:
--   {
--     "total_opportunities": 247,
--     "total_spend":         12450.00,
--     "selected_pipelines":  ["pid_a", "pid_b", ...],
--     "stage_totals": [
--       { "stage_name": "Blast",       "count": 145, "pipelines": 30 },
--       { "stage_name": "Interested",  "count": 22,  "pipelines": 30 },
--       ...
--     ],
--     "pipeline_breakdown": [
--       { "pipeline_id": "...", "pipeline_name": "...", "total": 12,
--         "by_stage": { "Blast": 8, "Interested": 4 } },
--       ...
--     ],
--     "computed_at": "..."
--   }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_selected         TEXT[];
  v_total_opps       INT;
  v_total_spend      NUMERIC(14,2);
  v_stage_totals     JSONB;
  v_pipeline_breakdown JSONB;
  v_period_start     DATE := date_trunc('month', current_date)::date;
  v_existing_data    JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT ghl_selected_pipeline_ids
    INTO v_selected
    FROM public.organizations WHERE id = p_org_id;

  -- Defensive: empty selection → write a no-op summary, don't error.
  IF v_selected IS NULL OR array_length(v_selected, 1) IS NULL THEN
    v_selected := '{}'::TEXT[];
  END IF;

  -- Total rows + spend across selected pipelines only.
  SELECT count(*), COALESCE(sum(spend), 0)
    INTO v_total_opps, v_total_spend
    FROM public.ghl_opportunities
   WHERE org_id = p_org_id
     AND pipeline_id = ANY(v_selected);

  -- Stage rollup: count opps grouped by stage NAME across selected pipelines.
  -- Stage name (rather than id) so that "Interested" in pipeline A and
  -- "Interested" in pipeline B aggregate into one row — which is exactly
  -- what the user asked for ("multiple pipelines summed together").
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'stage_name', stage_label,
           'count',      cnt,
           'pipelines',  pipeline_count
         ) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_stage_totals
  FROM (
    SELECT
      COALESCE(NULLIF(stage_name, ''), pipeline_stage_id, '(unknown stage)') AS stage_label,
      count(*) AS cnt,
      count(DISTINCT pipeline_id) AS pipeline_count
    FROM public.ghl_opportunities
    WHERE org_id = p_org_id
      AND pipeline_id = ANY(v_selected)
    GROUP BY stage_label
  ) s;

  -- Per-pipeline breakdown for drill-down.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'pipeline_id',    pid,
           'pipeline_name',  COALESCE(NULLIF(pname, ''), '(unnamed pipeline)'),
           'total',          total,
           'spend',          total_spend,
           'by_stage',       by_stage
         ) ORDER BY total DESC), '[]'::jsonb)
    INTO v_pipeline_breakdown
  FROM (
    SELECT
      pipeline_id AS pid,
      max(pipeline_name) AS pname,
      count(*) AS total,
      COALESCE(sum(spend), 0) AS total_spend,
      jsonb_object_agg(
        COALESCE(NULLIF(stage_name, ''), pipeline_stage_id, '(unknown)'),
        sc
      ) AS by_stage
    FROM (
      SELECT
        pipeline_id, pipeline_name, stage_name, pipeline_stage_id, spend,
        count(*) OVER (PARTITION BY pipeline_id, stage_name, pipeline_stage_id) AS sc
      FROM public.ghl_opportunities
      WHERE org_id = p_org_id
        AND pipeline_id = ANY(v_selected)
    ) raw
    GROUP BY pipeline_id
  ) pb;

  -- Upsert the current month's kpi_periods row, merging with any existing
  -- manual data (channels, reps, pnl) so we don't clobber anything.
  SELECT data INTO v_existing_data
    FROM public.kpi_periods
   WHERE org_id = p_org_id AND period_start = v_period_start;

  IF v_existing_data IS NULL THEN
    v_existing_data := '{}'::jsonb;
  END IF;

  v_existing_data := v_existing_data || jsonb_build_object(
    'ghl_channel', jsonb_build_object(
      'total_opportunities', v_total_opps,
      'total_spend',         v_total_spend,
      'selected_pipelines',  to_jsonb(v_selected),
      'stage_totals',        v_stage_totals,
      'pipeline_breakdown',  v_pipeline_breakdown,
      'computed_at',         to_jsonb(now())
    )
  );

  INSERT INTO public.kpi_periods (org_id, period_start, data, created_by)
  VALUES (p_org_id, v_period_start, v_existing_data, auth.uid())
  ON CONFLICT (org_id, period_start) DO UPDATE
    SET data = EXCLUDED.data,
        updated_at = now();

  UPDATE public.organizations
     SET ghl_last_sync_at    = now(),
         ghl_last_sync_error = NULL,
         ghl_status          = CASE WHEN ghl_status = 'error' THEN 'active' ELSE ghl_status END
   WHERE id = p_org_id;

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
    'total_spend',         v_total_spend,
    'stage_totals',        v_stage_totals,
    'pipeline_breakdown',  v_pipeline_breakdown
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID) TO authenticated;
