-- ============================================================================
-- Enrich ghl_sync_finalize with optional human-readable name lookup.
--
-- GHL's /opportunities/search returns pipeline_id + pipeline_stage_id but NOT
-- pipeline_name / pipeline_stage_name. So our ghl_opportunities rows have
-- NULL for those columns. To display real names in the result, the caller
-- passes the GHL pipelines payload (same shape returned by ghl_list_pipelines)
-- as the second arg; finalize uses it as an in-memory lookup map.
--
-- If p_pipelines is NULL, falls back to IDs (existing behavior).
-- ============================================================================

DROP FUNCTION IF EXISTS public.ghl_sync_finalize(UUID);

CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id    UUID,
  p_pipelines JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_selected           TEXT[];
  v_total_opps         INT;
  v_total_spend        NUMERIC(14,2);
  v_stage_totals       JSONB;
  v_pipeline_breakdown JSONB;
  v_period_start       DATE := date_trunc('month', current_date)::date;
  v_existing_data      JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT ghl_selected_pipeline_ids
    INTO v_selected
    FROM public.organizations WHERE id = p_org_id;

  IF v_selected IS NULL OR array_length(v_selected, 1) IS NULL THEN
    v_selected := '{}'::TEXT[];
  END IF;

  -- Build an in-memory (pipeline_id, stage_id) → name lookup from p_pipelines.
  CREATE TEMP TABLE IF NOT EXISTS _ghl_lookup (
    pipeline_id      TEXT,
    pipeline_name    TEXT,
    stage_id         TEXT,
    stage_name       TEXT,
    PRIMARY KEY (pipeline_id, stage_id)
  ) ON COMMIT DROP;
  TRUNCATE _ghl_lookup;

  IF p_pipelines IS NOT NULL AND jsonb_typeof(p_pipelines) = 'array' THEN
    INSERT INTO _ghl_lookup (pipeline_id, pipeline_name, stage_id, stage_name)
    SELECT
      p->>'id',
      p->>'name',
      s->>'id',
      s->>'name'
    FROM jsonb_array_elements(p_pipelines) p,
         jsonb_array_elements(p->'stages') s
    ON CONFLICT (pipeline_id, stage_id) DO NOTHING;
  END IF;

  -- Totals across selected pipelines.
  SELECT count(*), COALESCE(sum(spend), 0)
    INTO v_total_opps, v_total_spend
    FROM public.ghl_opportunities
   WHERE org_id = p_org_id
     AND pipeline_id = ANY(v_selected);

  -- Stage rollup: counts grouped by stage NAME (falling back to id) across all
  -- selected pipelines, so "Interested" in two pipelines aggregates as one row.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'stage_name', stage_label,
           'count',      cnt,
           'pipelines',  pipeline_count
         ) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_stage_totals
  FROM (
    SELECT
      COALESCE(
        NULLIF(o.stage_name, ''),
        l.stage_name,
        o.pipeline_stage_id,
        '(unknown stage)'
      ) AS stage_label,
      count(*) AS cnt,
      count(DISTINCT o.pipeline_id) AS pipeline_count
    FROM public.ghl_opportunities o
    LEFT JOIN _ghl_lookup l
      ON l.pipeline_id = o.pipeline_id AND l.stage_id = o.pipeline_stage_id
    WHERE o.org_id = p_org_id
      AND o.pipeline_id = ANY(v_selected)
    GROUP BY stage_label
  ) s;

  -- Per-pipeline breakdown for drill-down, also using the name lookup.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'pipeline_id',   pid,
           'pipeline_name', pname,
           'total',         total,
           'spend',         total_spend,
           'by_stage',      by_stage
         ) ORDER BY total DESC), '[]'::jsonb)
    INTO v_pipeline_breakdown
  FROM (
    SELECT
      o.pipeline_id AS pid,
      COALESCE(
        max(NULLIF(o.pipeline_name, '')),
        max(l_pl.pipeline_name),
        '(unnamed pipeline)'
      ) AS pname,
      count(*) AS total,
      COALESCE(sum(o.spend), 0) AS total_spend,
      jsonb_object_agg(
        COALESCE(NULLIF(o.stage_name, ''), max_stage_name, o.pipeline_stage_id, '(unknown)'),
        stage_count
      ) AS by_stage
    FROM (
      SELECT
        o.*,
        l.stage_name AS max_stage_name,
        count(*) OVER (PARTITION BY o.pipeline_id, o.pipeline_stage_id) AS stage_count
      FROM public.ghl_opportunities o
      LEFT JOIN _ghl_lookup l
        ON l.pipeline_id = o.pipeline_id AND l.stage_id = o.pipeline_stage_id
      WHERE o.org_id = p_org_id
        AND o.pipeline_id = ANY(v_selected)
    ) o
    LEFT JOIN (
      SELECT DISTINCT pipeline_id, pipeline_name FROM _ghl_lookup
    ) l_pl ON l_pl.pipeline_id = o.pipeline_id
    GROUP BY o.pipeline_id
  ) pb;

  -- Upsert kpi_periods, preserving manual data.
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

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;
