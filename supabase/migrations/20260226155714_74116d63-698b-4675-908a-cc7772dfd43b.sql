
-- Fix kpi_periods: make all policies PERMISSIVE (OR logic)
DROP POLICY IF EXISTS "Admins full access to kpi_periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "Client users can insert current month periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "Client users can update current month periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "Client users can view own org periods" ON public.kpi_periods;

CREATE POLICY "Admins full access to kpi_periods"
  ON public.kpi_periods AS PERMISSIVE FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Client users can view own org periods"
  ON public.kpi_periods AS PERMISSIVE FOR SELECT
  USING (org_id = my_org_id(auth.uid()));

CREATE POLICY "Client users can insert current month periods"
  ON public.kpi_periods AS PERMISSIVE FOR INSERT
  WITH CHECK (
    (org_id = my_org_id(auth.uid()))
    AND subscription_is_active(org_id)
    AND (period_start >= (date_trunc('month', CURRENT_DATE))::date)
  );

CREATE POLICY "Client users can update current month periods"
  ON public.kpi_periods AS PERMISSIVE FOR UPDATE
  USING (
    (org_id = my_org_id(auth.uid()))
    AND subscription_is_active(org_id)
    AND (period_start >= (date_trunc('month', CURRENT_DATE))::date)
    AND (is_locked = false)
  )
  WITH CHECK (
    (org_id = my_org_id(auth.uid()))
    AND subscription_is_active(org_id)
    AND (period_start >= (date_trunc('month', CURRENT_DATE))::date)
    AND (is_locked = false)
  );
