-- ============================================================================
-- Channel-signal discovery for the GHL integration.
--
-- iBuyKC's data showed that contact.source is mostly junk (addresses, dates)
-- while the real channel info lives in `tags` (e.g. "agency google ppc",
-- "callrails") and in named custom fields (e.g. "Lead Source"). Per user
-- direction we don't pick the field; the admin does.
--
-- This migration adds:
--   • organizations.ghl_custom_fields_cache JSONB — last fetch of /locations/{id}/customFields
--   • organizations.ghl_channel_signal      JSONB — admin's choice + mapping
--   • RPCs to fetch custom field defs, list value distributions across all
--     candidate fields, save the chosen signal + mapping
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ghl_custom_fields_cache JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ghl_channel_signal      JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.ghl_custom_fields_cache IS
  'Last cached /locations/{id}/customFields response — used to translate custom field IDs to human names.';
COMMENT ON COLUMN public.organizations.ghl_channel_signal IS
  'Admin-configured channel signal. Shape: '
  '{"field_type":"source"|"tags"|"custom_field","field_id":"<id>","field_name":"<name>",'
  '"value_to_channel":{"<value>":"<channel name>"}}';

-- ─── Fetch custom field definitions from GHL ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_fetch_custom_fields_start(
  p_org_id UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id TEXT; v_pit TEXT;
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
  RETURN public._ghl_dispatch_get(
    'https://services.leadconnectorhq.com/locations/' || v_location_id || '/customFields',
    v_pit
  );
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_fetch_custom_fields_start(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ghl_fetch_custom_fields_finish(
  p_org_id     UUID,
  p_request_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_resp RECORD; v_body JSONB; v_fields JSONB;
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
  v_body := v_resp.content::jsonb;
  -- GHL returns { customFields: [ {id, name, fieldKey, dataType, ...} ] }
  v_fields := COALESCE(v_body->'customFields', v_body->'fields', '[]'::jsonb);

  UPDATE public.organizations SET ghl_custom_fields_cache = v_fields WHERE id = p_org_id;
  RETURN jsonb_build_object('ok', true, 'fields_count', jsonb_array_length(v_fields));
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_fetch_custom_fields_finish(UUID, BIGINT) TO authenticated;

-- ─── Distribution: every candidate channel-signal field, distinct values ───
-- Returns:
-- {
--   "source": [{ "value": "...", "contact_count": N, "won_count": N, "won_revenue": $ }, ...],
--   "tags":   [{ "value": "...", ...}, ...],
--   "custom_fields": [
--     { "field_id": "...", "field_name": "Lead Source",
--       "values": [{ "value": "Signal Sniping", ...}, ...] },
--     ...
--   ]
-- }
CREATE OR REPLACE FUNCTION public.ghl_channel_signal_distribution(
  p_org_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_dist  JSONB;
  v_tag_dist     JSONB;
  v_cf_defs      JSONB;
  v_cf_dist      JSONB := '[]'::jsonb;
  v_cf           JSONB;
  v_cf_id        TEXT;
  v_cf_name      TEXT;
  v_cf_values    JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  -- source distribution
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'value',         val,
           'contact_count', cc,
           'won_count',     wc,
           'won_revenue',   wr
         ) ORDER BY wc DESC, cc DESC), '[]'::jsonb)
    INTO v_source_dist
  FROM (
    SELECT
      COALESCE(NULLIF(c.source, ''), '(no source)') AS val,
      count(DISTINCT c.ghl_contact_id) AS cc,
      count(o.ghl_opportunity_id) FILTER (WHERE o.status = 'won') AS wc,
      COALESCE(sum(o.monetary_value) FILTER (WHERE o.status = 'won'), 0) AS wr
    FROM public.ghl_contacts c
    LEFT JOIN public.ghl_opportunities o
      ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id
    GROUP BY 1
  ) s;

  -- tags distribution (one row per tag, contacts can have many)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'value',         tag,
           'contact_count', cc,
           'won_count',     wc,
           'won_revenue',   wr
         ) ORDER BY wc DESC, cc DESC), '[]'::jsonb)
    INTO v_tag_dist
  FROM (
    SELECT
      tag,
      count(DISTINCT c.ghl_contact_id) AS cc,
      count(DISTINCT o.ghl_opportunity_id) FILTER (WHERE o.status = 'won') AS wc,
      COALESCE(sum(o.monetary_value) FILTER (WHERE o.status = 'won'), 0) AS wr
    FROM public.ghl_contacts c,
         jsonb_array_elements_text(c.tags) tag
    LEFT JOIN public.ghl_opportunities o
      ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id
    GROUP BY 1
  ) t;

  -- custom fields: iterate each cached field def, compute distribution of its values
  SELECT ghl_custom_fields_cache INTO v_cf_defs
    FROM public.organizations WHERE id = p_org_id;

  FOR v_cf IN SELECT * FROM jsonb_array_elements(COALESCE(v_cf_defs, '[]'::jsonb)) LOOP
    v_cf_id   := v_cf->>'id';
    v_cf_name := COALESCE(v_cf->>'name', v_cf->>'fieldKey', v_cf->>'id');

    -- Each contact's custom_fields is an array of {id, value} OR an object.
    -- Handle both shapes.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'value',         val,
             'contact_count', cc,
             'won_count',     wc,
             'won_revenue',   wr
           ) ORDER BY wc DESC, cc DESC), '[]'::jsonb)
      INTO v_cf_values
    FROM (
      SELECT
        val,
        count(DISTINCT c.ghl_contact_id) AS cc,
        count(DISTINCT o.ghl_opportunity_id) FILTER (WHERE o.status = 'won') AS wc,
        COALESCE(sum(o.monetary_value) FILTER (WHERE o.status = 'won'), 0) AS wr
      FROM public.ghl_contacts c
      LEFT JOIN public.ghl_opportunities o
        ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id,
      LATERAL (
        -- Array form: search by id
        SELECT cf->>'value' AS val
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.custom_fields) = 'array'
                 THEN c.custom_fields ELSE '[]'::jsonb END
          ) cf
         WHERE cf->>'id' = v_cf_id
        UNION ALL
        -- Object form: look up by key
        SELECT c.custom_fields->>v_cf_id AS val
         WHERE jsonb_typeof(c.custom_fields) = 'object'
           AND c.custom_fields ? v_cf_id
      ) extracted
      WHERE c.org_id = p_org_id
        AND extracted.val IS NOT NULL
        AND extracted.val <> ''
      GROUP BY 1
    ) cfv;

    IF jsonb_array_length(v_cf_values) > 0 THEN
      v_cf_dist := v_cf_dist || jsonb_build_array(jsonb_build_object(
        'field_id',   v_cf_id,
        'field_name', v_cf_name,
        'values',     v_cf_values
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'source',        v_source_dist,
    'tags',          v_tag_dist,
    'custom_fields', v_cf_dist
  );
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_channel_signal_distribution(UUID) TO authenticated;

-- ─── Save channel signal config ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_save_channel_signal(
  p_org_id UUID,
  p_config JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  UPDATE public.organizations
     SET ghl_channel_signal = COALESCE(p_config, '{}'::jsonb)
   WHERE id = p_org_id;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_save_channel_signal(UUID, JSONB) TO authenticated;
