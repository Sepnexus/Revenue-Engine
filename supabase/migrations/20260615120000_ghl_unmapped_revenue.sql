-- ============================================================================
-- ghl_unmapped_won(org): surfaces closed revenue that the dashboard is NOT
-- counting because the lead's source/tag/custom-field value isn't mapped to
-- any channel.
--
-- The finalize logic only attributes a won opportunity to a channel if the
-- opp's contact matches one of the configured channel source_rules. Anything
-- unmatched is silently dropped — so a client whose mapping covers only some
-- of their lead sources sees an understated revenue figure.
--
-- This function returns:
--   { total_unmapped_deals, total_unmapped_revenue, total_mapped_revenue,
--     by_value: [ { signal, field_id, field_name, value, deals, revenue }, ... ] }
--
-- by_value breaks the unmapped deals down by whichever signal types the org's
-- channels already use (custom_field / tags / source field), so the admin
-- sees exactly which values to map — ranked by revenue, biggest gaps first.
-- The headline totals count DISTINCT contacts (no double-count); the by_value
-- breakdown is guidance and may attribute one contact to multiple rows if its
-- data carries several candidate values.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ghl_unmapped_won(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mapped_deals    INT := 0;
  v_mapped_rev      NUMERIC(14,2) := 0;
  v_unmapped_deals  INT := 0;
  v_unmapped_rev    NUMERIC(14,2) := 0;
  v_by_value        JSONB := '[]'::jsonb;
  v_uses_sources    BOOLEAN;
  v_uses_tags       BOOLEAN;
  v_cf_field_ids    TEXT[];
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  -- Which contacts are matched to ANY channel (same rule logic as finalize).
  CREATE TEMP TABLE IF NOT EXISTS _mapped (contact_id TEXT PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _mapped;

  INSERT INTO _mapped (contact_id)
  SELECT DISTINCT cid FROM (
    SELECT c.ghl_contact_id AS cid
      FROM public.ghl_contacts c, public.org_channels ch
     WHERE c.org_id = p_org_id AND ch.org_id = p_org_id
       AND c.source IS NOT NULL AND c.source <> ''
       AND ch.source_rules ? 'sources'
       AND ch.source_rules->'sources' @> to_jsonb(c.source)::jsonb
    UNION
    SELECT c.ghl_contact_id
      FROM public.ghl_contacts c
      CROSS JOIN LATERAL jsonb_array_elements_text(c.tags) t
      JOIN public.org_channels ch ON ch.org_id = p_org_id
       AND ch.source_rules ? 'tags' AND ch.source_rules->'tags' @> to_jsonb(t)::jsonb
     WHERE c.org_id = p_org_id
    UNION
    SELECT c.ghl_contact_id
      FROM public.ghl_contacts c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.custom_fields)='array' THEN c.custom_fields ELSE '[]'::jsonb END
      ) cf
      JOIN public.org_channels ch ON ch.org_id = p_org_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ch.source_rules->'custom_fields','[]'::jsonb)) rule
     WHERE c.org_id = p_org_id
       AND cf->>'id' = rule->>'field_id'
       AND cf->>'value' = ANY (SELECT jsonb_array_elements_text(rule->'values'))
  ) m;

  -- Mapped vs unmapped won totals (distinct contacts via the won opps join).
  SELECT
    count(*) FILTER (WHERE mp.contact_id IS NOT NULL),
    COALESCE(sum(o.monetary_value) FILTER (WHERE mp.contact_id IS NOT NULL), 0),
    count(*) FILTER (WHERE mp.contact_id IS NULL),
    COALESCE(sum(o.monetary_value) FILTER (WHERE mp.contact_id IS NULL), 0)
  INTO v_mapped_deals, v_mapped_rev, v_unmapped_deals, v_unmapped_rev
  FROM public.ghl_opportunities o
  JOIN public.ghl_contacts c ON c.org_id = o.org_id AND c.ghl_contact_id = o.ghl_contact_id
  LEFT JOIN _mapped mp ON mp.contact_id = c.ghl_contact_id
  WHERE o.org_id = p_org_id AND o.status = 'won';

  -- Which signal types are the org's channels configured to use?
  SELECT
    bool_or(jsonb_array_length(COALESCE(source_rules->'sources','[]'::jsonb)) > 0),
    bool_or(jsonb_array_length(COALESCE(source_rules->'tags','[]'::jsonb)) > 0)
  INTO v_uses_sources, v_uses_tags
  FROM public.org_channels WHERE org_id = p_org_id;

  SELECT array_agg(DISTINCT rule->>'field_id')
  INTO v_cf_field_ids
  FROM public.org_channels ch
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ch.source_rules->'custom_fields','[]'::jsonb)) rule
  WHERE ch.org_id = p_org_id;

  -- Breakdown over UNMAPPED won contacts, by each signal type in use.
  WITH unmapped_won AS (
    SELECT DISTINCT c.ghl_contact_id, c.source, c.tags, c.custom_fields, o.monetary_value
    FROM public.ghl_opportunities o
    JOIN public.ghl_contacts c ON c.org_id = o.org_id AND c.ghl_contact_id = o.ghl_contact_id
    LEFT JOIN _mapped mp ON mp.contact_id = c.ghl_contact_id
    WHERE o.org_id = p_org_id AND o.status = 'won' AND mp.contact_id IS NULL
  ),
  -- custom-field values for the fields channels reference
  cf_vals AS (
    SELECT 'custom_field' AS signal, cf->>'id' AS field_id, cf->>'value' AS value,
           count(*) AS deals, sum(uw.monetary_value) AS revenue
    FROM unmapped_won uw
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(uw.custom_fields)='array' THEN uw.custom_fields ELSE '[]'::jsonb END
    ) cf
    WHERE v_cf_field_ids IS NOT NULL
      AND cf->>'id' = ANY (v_cf_field_ids)
      AND COALESCE(cf->>'value','') <> ''
    GROUP BY 1,2,3
  ),
  tag_vals AS (
    SELECT 'tags' AS signal, NULL::text AS field_id, t AS value,
           count(*) AS deals, sum(uw.monetary_value) AS revenue
    FROM unmapped_won uw
    CROSS JOIN LATERAL jsonb_array_elements_text(uw.tags) t
    WHERE v_uses_tags
    GROUP BY 1,2,3
  ),
  src_vals AS (
    SELECT 'source' AS signal, NULL::text AS field_id, uw.source AS value,
           count(*) AS deals, sum(uw.monetary_value) AS revenue
    FROM unmapped_won uw
    WHERE v_uses_sources AND COALESCE(uw.source,'') <> ''
    GROUP BY 1,2,3
  ),
  combined AS (
    SELECT * FROM cf_vals
    UNION ALL SELECT * FROM tag_vals
    UNION ALL SELECT * FROM src_vals
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'signal',     signal,
           'field_id',   field_id,
           'field_name', (SELECT cfdef->>'name'
                            FROM public.organizations o2,
                                 jsonb_array_elements(o2.ghl_custom_fields_cache) cfdef
                           WHERE o2.id = p_org_id AND cfdef->>'id' = combined.field_id
                           LIMIT 1),
           'value',      value,
           'deals',      deals,
           'revenue',    revenue
         ) ORDER BY revenue DESC, deals DESC), '[]'::jsonb)
  INTO v_by_value
  FROM combined;

  RETURN jsonb_build_object(
    'total_mapped_deals',    v_mapped_deals,
    'total_mapped_revenue',  v_mapped_rev,
    'total_unmapped_deals',  v_unmapped_deals,
    'total_unmapped_revenue',v_unmapped_rev,
    'by_value',              v_by_value
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_unmapped_won(UUID) TO authenticated;
