-- Fix: distribution function had a bad LATERAL join causing
-- "invalid reference to FROM-clause entry for table 'c'". Rewrite the
-- custom-field value extraction as a correlated CASE expression — no LATERAL.

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

  -- source field distribution
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'value', val, 'contact_count', cc,
           'won_count', wc, 'won_revenue', wr
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

  -- tags distribution (LATERAL on jsonb_array_elements_text is safe — single table)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'value', tag, 'contact_count', cc,
           'won_count', wc, 'won_revenue', wr
         ) ORDER BY wc DESC, cc DESC), '[]'::jsonb)
    INTO v_tag_dist
  FROM (
    SELECT
      tag,
      count(DISTINCT c.ghl_contact_id) AS cc,
      count(DISTINCT o.ghl_opportunity_id) FILTER (WHERE o.status = 'won') AS wc,
      COALESCE(sum(o.monetary_value) FILTER (WHERE o.status = 'won'), 0) AS wr
    FROM public.ghl_contacts c
    CROSS JOIN LATERAL jsonb_array_elements_text(c.tags) AS tag
    LEFT JOIN public.ghl_opportunities o
      ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
    WHERE c.org_id = p_org_id
    GROUP BY 1
  ) t;

  -- custom field distributions, one field at a time. Inline the value
  -- extraction as a CASE+subquery so there's no LATERAL ambiguity.
  SELECT ghl_custom_fields_cache INTO v_cf_defs
    FROM public.organizations WHERE id = p_org_id;

  FOR v_cf IN SELECT * FROM jsonb_array_elements(COALESCE(v_cf_defs, '[]'::jsonb)) LOOP
    v_cf_id   := v_cf->>'id';
    v_cf_name := COALESCE(v_cf->>'name', v_cf->>'fieldKey', v_cf->>'id');

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'value', val, 'contact_count', cc,
             'won_count', wc, 'won_revenue', wr
           ) ORDER BY wc DESC, cc DESC), '[]'::jsonb)
      INTO v_cf_values
    FROM (
      SELECT
        val,
        count(DISTINCT contact_id) AS cc,
        count(DISTINCT opp_id) FILTER (WHERE won) AS wc,
        COALESCE(sum(rev) FILTER (WHERE won), 0) AS wr
      FROM (
        SELECT
          c.ghl_contact_id AS contact_id,
          o.ghl_opportunity_id AS opp_id,
          (o.status = 'won') AS won,
          o.monetary_value AS rev,
          CASE
            WHEN jsonb_typeof(c.custom_fields) = 'array' THEN (
              SELECT cf->>'value'
                FROM jsonb_array_elements(c.custom_fields) cf
               WHERE cf->>'id' = v_cf_id
               LIMIT 1
            )
            WHEN jsonb_typeof(c.custom_fields) = 'object'
                  AND c.custom_fields ? v_cf_id
              THEN c.custom_fields->>v_cf_id
            ELSE NULL
          END AS val
        FROM public.ghl_contacts c
        LEFT JOIN public.ghl_opportunities o
          ON o.org_id = c.org_id AND o.ghl_contact_id = c.ghl_contact_id
        WHERE c.org_id = p_org_id
      ) extracted
      WHERE val IS NOT NULL AND val <> ''
      GROUP BY val
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
