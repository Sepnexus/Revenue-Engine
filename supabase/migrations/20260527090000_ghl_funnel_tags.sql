-- ============================================================================
-- Tag-driven funnel: each org defines five funnel tags. Sync counts contacts
-- with each tag, bucketed by month + channel, to populate the full funnel:
--
--   newLeads  ← "untouched"
--   netLeads  ← "net lead"
--   offers    ← "offer made"
--   contracts ← "under contract"
--   closedDeals ← "closed"
--
-- Tag names are stored per-org so different clients can override if their
-- naming conventions differ. Defaults match the user's spec.
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ghl_funnel_tags JSONB NOT NULL DEFAULT jsonb_build_object(
    'newLeads',    'untouched',
    'netLeads',    'net lead',
    'offers',      'offer made',
    'contracts',   'under contract',
    'closedDeals', 'closed'
  );

COMMENT ON COLUMN public.organizations.ghl_funnel_tags IS
  'Per-org funnel tag map. Each value is the GHL contact tag name that signals the contact has reached that funnel position. Sync counts contacts having each tag (bucketed by month + channel) to populate the dashboard funnel.';

-- Backfill: any existing rows get the defaults too (ALTER ADD COLUMN sets
-- the default but only on rows inserted after; explicit UPDATE is safer).
UPDATE public.organizations
   SET ghl_funnel_tags = jsonb_build_object(
     'newLeads',    'untouched',
     'netLeads',    'net lead',
     'offers',      'offer made',
     'contracts',   'under contract',
     'closedDeals', 'closed'
   )
 WHERE ghl_funnel_tags IS NULL
    OR ghl_funnel_tags = '{}'::jsonb;

-- Small RPC so admin can edit later if needed.
CREATE OR REPLACE FUNCTION public.ghl_save_funnel_tags(
  p_org_id UUID,
  p_tags   JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  UPDATE public.organizations
     SET ghl_funnel_tags = COALESCE(p_tags, ghl_funnel_tags)
   WHERE id = p_org_id;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.ghl_save_funnel_tags(UUID, JSONB) TO authenticated;
