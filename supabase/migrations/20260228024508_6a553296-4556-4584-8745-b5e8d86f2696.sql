
-- Drop the old restrictive policies
DROP POLICY IF EXISTS "Client users can insert current month periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "Client users can update current month periods" ON public.kpi_periods;

-- New INSERT policy: any month, as long as subscription is active
CREATE POLICY "Client users can insert periods"
ON public.kpi_periods
FOR INSERT
WITH CHECK (
  org_id = my_org_id(auth.uid())
  AND subscription_is_active(org_id)
);

-- New UPDATE policy: any unlocked month, as long as subscription is active
CREATE POLICY "Client users can update unlocked periods"
ON public.kpi_periods
FOR UPDATE
USING (
  org_id = my_org_id(auth.uid())
  AND subscription_is_active(org_id)
  AND is_locked = false
)
WITH CHECK (
  org_id = my_org_id(auth.uid())
  AND subscription_is_active(org_id)
  AND is_locked = false
);
