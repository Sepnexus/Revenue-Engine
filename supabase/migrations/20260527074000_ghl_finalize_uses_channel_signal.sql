-- ============================================================================
-- ghl_sync_finalize v3: reads ghl_channel_signal config and derives each
-- WON opportunity's channel from the configured field — source, a tag, or a
-- custom field. Then aggregates by (close-month, channel) and writes
-- per-month kpi_periods.data.channels[].
--
-- Channel signal config shape (saved by ghl_save_channel_signal):
--   {
--     "field_type":  "source" | "tags" | "custom_field",
--     "field_id":     <custom field id, when field_type=custom_field>,
--     "field_name":   <human label for UI>,
--     "value_to_channel": {
--        "agency google ppc": "PPC / Google",
--        "callrails":         "Cold Calling",
--        ...
--     },
--     "default_channel":  "Other / Unmapped"   ← optional, defaults to "Other / Unmapped"
--   }
-- ============================================================================

DROP FUNCTION IF EXISTS public.ghl_sync_finalize(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.ghl_sync_finalize(
  p_org_id    UUID,
  p_pipelines JSONB DEFAULT NULL  -- kept for API compatibility; unused now
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signal           JSONB;
  v_field_type       TEXT;
  v_field_id         TEXT;
  v_mapping          JSONB;
  v_default_channel  TEXT;
  v_periods_touched   INT := 0;
  v_total_won_revenue NUMERIC(14,2) := 0;
  v_total_won_count   INT := 0;
  v_rec               RECORD;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT ghl_channel_signal INTO v_signal
    FROM public.organizations WHERE id = p_org_id;

  v_signal          := COALESCE(v_signal, '{}'::jsonb);
  v_field_type      := COALESCE(v_signal->>'field_type', 'source');
  v_field_id        := v_signal->>'field_id';
  v_mapping         := COALESCE(v_signal->'value_to_channel', '{}'::jsonb);
  v_default_channel := COALESCE(NULLIF(v_signal->>'default_channel', ''), 'Other / Unmapped');

  -- ─── For each WON opp, resolve (close_month, channel) and write into a
  --     temp table. Channel resolution depends on field_type.
  CREATE TEMP TABLE IF NOT EXISTS _ghl_won_agg (
    period_start    DATE,
    channel         TEXT,
    closed_deals    INT,
    closed_revenue  NUMERIC(14,2),
    total_spend     NUMERIC(14,2),
    PRIMARY KEY (period_start, channel)
  ) ON COMMIT DROP;
  TRUNCATE _ghl_won_agg;

  IF v_field_type = 'source' THEN
    INSERT INTO _ghl_won_agg
    SELECT
      date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at, now()))::date,
      COALESCE(
        NULLIF(v_mapping->>(COALESCE(c.source, '(no source)')), ''),
        v_default_channel
      ),
      count(*),
      COALESCE(sum(o.monetary_value), 0),
      COALESCE(sum(o.spend), 0)
    FROM public.ghl_opportunities o
    LEFT JOIN public.ghl_contacts c
      ON c.org_id = o.org_id AND c.ghl_contact_id = o.ghl_contact_id
    WHERE o.org_id = p_org_id
      AND o.status = 'won'
      AND o.ghl_updated_at IS NOT NULL
    GROUP BY 1, 2;

  ELSIF v_field_type = 'tags' THEN
    -- Each won opp's channel = first matching tag whose key appears in mapping.
    -- If none of the contact's tags match, default_channel.
    INSERT INTO _ghl_won_agg
    SELECT
      period_start, channel, count(*), sum(monetary_value), sum(spend)
    FROM (
      SELECT
        date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at, now()))::date AS period_start,
        COALESCE(
          (
            SELECT v_mapping->>tag
              FROM jsonb_array_elements_text(c.tags) tag
             WHERE v_mapping ? tag
             LIMIT 1
          ),
          v_default_channel
        ) AS channel,
        o.monetary_value, o.spend
      FROM public.ghl_opportunities o
      LEFT JOIN public.ghl_contacts c
        ON c.org_id = o.org_id AND c.ghl_contact_id = o.ghl_contact_id
      WHERE o.org_id = p_org_id
        AND o.status = 'won'
        AND o.ghl_updated_at IS NOT NULL
    ) x
    GROUP BY 1, 2;

  ELSIF v_field_type = 'custom_field' AND v_field_id IS NOT NULL THEN
    INSERT INTO _ghl_won_agg
    SELECT
      period_start, channel, count(*), sum(monetary_value), sum(spend)
    FROM (
      SELECT
        date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at, now()))::date AS period_start,
        COALESCE(
          NULLIF(v_mapping->>(
            COALESCE(
              -- Array form lookup
              (SELECT cf->>'value'
                 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(c.custom_fields)='array'
                        THEN c.custom_fields ELSE '[]'::jsonb END
                 ) cf
                WHERE cf->>'id' = v_field_id
                LIMIT 1),
              -- Object form lookup
              CASE WHEN jsonb_typeof(c.custom_fields)='object'
                   THEN c.custom_fields->>v_field_id END,
              ''
            )
          ), ''),
          v_default_channel
        ) AS channel,
        o.monetary_value, o.spend
      FROM public.ghl_opportunities o
      LEFT JOIN public.ghl_contacts c
        ON c.org_id = o.org_id AND c.ghl_contact_id = o.ghl_contact_id
      WHERE o.org_id = p_org_id
        AND o.status = 'won'
        AND o.ghl_updated_at IS NOT NULL
    ) x
    GROUP BY 1, 2;

  ELSE
    -- No signal configured yet: bucket everything into default_channel.
    INSERT INTO _ghl_won_agg
    SELECT
      date_trunc('month', COALESCE(o.ghl_updated_at, o.ghl_created_at, now()))::date,
      v_default_channel,
      count(*),
      COALESCE(sum(o.monetary_value), 0),
      COALESCE(sum(o.spend), 0)
    FROM public.ghl_opportunities o
    WHERE o.org_id = p_org_id
      AND o.status = 'won'
      AND o.ghl_updated_at IS NOT NULL
    GROUP BY 1;
  END IF;

  SELECT
    count(DISTINCT period_start),
    COALESCE(sum(closed_revenue), 0),
    COALESCE(sum(closed_deals), 0)
  INTO v_periods_touched, v_total_won_revenue, v_total_won_count
  FROM _ghl_won_agg;

  -- ─── Upsert kpi_periods per month, merging with existing manual channels ──
  FOR v_rec IN
    SELECT period_start,
           jsonb_agg(jsonb_build_object(
             'name',          channel,
             'closedDeals',   closed_deals,
             'closedRevenue', closed_revenue,
             'spend',         total_spend,
             'source',        'ghl',
             'newLeads',      0,
             'netLeads',      0,
             'offers',        0,
             'contracts',     closed_deals
           )) AS ghl_channels
      FROM _ghl_won_agg
      GROUP BY period_start
  LOOP
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
  END LOOP;

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
    'ok',                true,
    'field_type_used',   v_field_type,
    'months_touched',    v_periods_touched,
    'total_won_deals',   v_total_won_count,
    'total_won_revenue', v_total_won_revenue
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_sync_finalize(UUID, JSONB) TO authenticated;
