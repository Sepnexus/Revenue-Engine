
-- ============================================
-- ENTERPRISE UPGRADE MIGRATION
-- ============================================

-- 1) Add schema_version to kpi_periods
ALTER TABLE public.kpi_periods ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;

-- 2) Add last_login_at to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- 3) Unique constraint on kpi_periods (org_id, period_start) if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kpi_periods_org_period_unique'
  ) THEN
    ALTER TABLE public.kpi_periods ADD CONSTRAINT kpi_periods_org_period_unique UNIQUE (org_id, period_start);
  END IF;
END $$;

-- 4) Validation trigger: period_start must be first day of month
CREATE OR REPLACE FUNCTION public.validate_period_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXTRACT(DAY FROM NEW.period_start) != 1 THEN
    RAISE EXCEPTION 'period_start must be the first day of a month';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_period_start ON public.kpi_periods;
CREATE TRIGGER trg_validate_period_start
  BEFORE INSERT OR UPDATE ON public.kpi_periods
  FOR EACH ROW EXECUTE FUNCTION public.validate_period_start();

-- 5) AUDIT_LOGS table (append-only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  org_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit_logs, nobody can update/delete
CREATE POLICY "Admins can read audit_logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can insert audit_logs"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Service role can also insert (for edge functions)
CREATE POLICY "Service can insert audit_logs"
  ON public.audit_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 6) KPI_PERIOD_REVISIONS table
CREATE TABLE IF NOT EXISTS public.kpi_period_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_period_id uuid NOT NULL REFERENCES public.kpi_periods(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  edited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kpi_period_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to kpi_period_revisions"
  ON public.kpi_period_revisions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org revisions"
  ON public.kpi_period_revisions FOR SELECT
  TO authenticated
  USING (org_id = public.my_org_id(auth.uid()));

CREATE POLICY "Client users can insert own org revisions"
  ON public.kpi_period_revisions FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.my_org_id(auth.uid()));

-- 7) SUBSCRIPTION_EVENTS table
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  changed_by uuid,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  previous_expiry timestamptz,
  new_expiry timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to subscription_events"
  ON public.subscription_events FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 8) Drop existing client kpi_periods policies and recreate with stricter enforcement
DROP POLICY IF EXISTS "Client users can insert current month periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "Client users can update current month periods" ON public.kpi_periods;

-- Clients can only INSERT if subscription active AND current month
CREATE POLICY "Client users can insert current month periods"
  ON public.kpi_periods FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = public.my_org_id(auth.uid())
    AND public.subscription_is_active(org_id)
    AND period_start >= (date_trunc('month', CURRENT_DATE))::date
  );

-- Clients can only UPDATE if subscription active AND current month AND not locked
CREATE POLICY "Client users can update current month periods"
  ON public.kpi_periods FOR UPDATE
  TO authenticated
  USING (
    org_id = public.my_org_id(auth.uid())
    AND public.subscription_is_active(org_id)
    AND period_start >= (date_trunc('month', CURRENT_DATE))::date
    AND is_locked = false
  )
  WITH CHECK (
    org_id = public.my_org_id(auth.uid())
    AND public.subscription_is_active(org_id)
    AND period_start >= (date_trunc('month', CURRENT_DATE))::date
    AND is_locked = false
  );

-- 9) Prevent clients from deleting kpi_periods (only admin can via existing ALL policy)
-- No DELETE policy for client_user means they cannot delete.

-- 10) Prevent clients from modifying subscriptions, audit_logs, subscription_events, user_roles
-- Already handled by existing RLS: only admin has ALL, clients have no write policies on these tables.

-- 11) Auto-save revision on KPI period update
CREATE OR REPLACE FUNCTION public.save_kpi_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO public.kpi_period_revisions (kpi_period_id, org_id, data, edited_by)
    VALUES (OLD.id, OLD.org_id, OLD.data, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_save_kpi_revision ON public.kpi_periods;
CREATE TRIGGER trg_save_kpi_revision
  BEFORE UPDATE ON public.kpi_periods
  FOR EACH ROW EXECUTE FUNCTION public.save_kpi_revision();
