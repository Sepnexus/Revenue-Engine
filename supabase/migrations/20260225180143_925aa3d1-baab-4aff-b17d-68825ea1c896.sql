
-- ============================================================
-- Revenue Engine Multi-Tenant SaaS Schema
-- ============================================================

-- 1. Role enum
CREATE TYPE public.app_role AS ENUM ('super_admin', 'client_user');

-- 2. Plan status enum
CREATE TYPE public.plan_status AS ENUM ('active', 'trial', 'expired', 'suspended');

-- 3. Organizations table
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- 4. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id),
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. User roles table (separate from profiles to prevent privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- 6. Subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL DEFAULT 'Starter',
  plan_status public.plan_status NOT NULL DEFAULT 'trial',
  expires_at TIMESTAMPTZ,
  seats_limit INT,
  renewal_notes TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. KPI Periods table
CREATE TABLE public.kpi_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  data JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, period_start)
);

CREATE INDEX idx_kpi_periods_org_period ON public.kpi_periods(org_id, period_start DESC);

-- ============================================================
-- Security Definer Helper Functions
-- ============================================================

-- has_role: check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- my_org_id: get user's org_id from profiles
CREATE OR REPLACE FUNCTION public.my_org_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles
  WHERE id = _user_id
$$;

-- subscription_is_active: check if org has active subscription
CREATE OR REPLACE FUNCTION public.subscription_is_active(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE org_id = _org_id
      AND plan_status IN ('active', 'trial')
      AND (expires_at IS NULL OR expires_at >= now())
  )
$$;

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_periods ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies: organizations
-- ============================================================
CREATE POLICY "Admins full access to organizations"
  ON public.organizations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org"
  ON public.organizations FOR SELECT TO authenticated
  USING (id = public.my_org_id(auth.uid()));

-- ============================================================
-- RLS Policies: profiles
-- ============================================================
CREATE POLICY "Admins full access to profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND org_id = public.my_org_id(auth.uid()));

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ============================================================
-- RLS Policies: user_roles
-- ============================================================
CREATE POLICY "Admins full access to user_roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- RLS Policies: subscriptions
-- ============================================================
CREATE POLICY "Admins full access to subscriptions"
  ON public.subscriptions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (org_id = public.my_org_id(auth.uid()));

-- ============================================================
-- RLS Policies: kpi_periods
-- ============================================================
CREATE POLICY "Admins full access to kpi_periods"
  ON public.kpi_periods FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org periods"
  ON public.kpi_periods FOR SELECT TO authenticated
  USING (org_id = public.my_org_id(auth.uid()));

CREATE POLICY "Client users can insert current month periods"
  ON public.kpi_periods FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.my_org_id(auth.uid())
    AND public.subscription_is_active(org_id)
    AND period_start >= date_trunc('month', CURRENT_DATE)::date
  );

CREATE POLICY "Client users can update current month periods"
  ON public.kpi_periods FOR UPDATE TO authenticated
  USING (
    org_id = public.my_org_id(auth.uid())
    AND public.subscription_is_active(org_id)
    AND period_start >= date_trunc('month', CURRENT_DATE)::date
  )
  WITH CHECK (
    org_id = public.my_org_id(auth.uid())
    AND public.subscription_is_active(org_id)
    AND period_start >= date_trunc('month', CURRENT_DATE)::date
  );

-- ============================================================
-- Trigger: auto-update updated_at on kpi_periods
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_kpi_periods_updated_at
  BEFORE UPDATE ON public.kpi_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Trigger: auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
