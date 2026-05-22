
-- 1) org_settings table
CREATE TABLE public.org_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  timezone text DEFAULT 'America/New_York',
  logo_url text,
  onboarding_dismissed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to org_settings" ON public.org_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Client users can view own org settings" ON public.org_settings FOR SELECT TO authenticated
  USING (org_id = public.my_org_id(auth.uid()));
CREATE POLICY "Client users can upsert own org settings" ON public.org_settings FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id(auth.uid()));
CREATE POLICY "Client users can update own org settings" ON public.org_settings FOR UPDATE TO authenticated
  USING (org_id = public.my_org_id(auth.uid())) WITH CHECK (org_id = public.my_org_id(auth.uid()));

CREATE TRIGGER update_org_settings_updated_at BEFORE UPDATE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) activity_events table
CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to activity_events" ON public.activity_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Client users can view own org activity" ON public.activity_events FOR SELECT TO authenticated
  USING (org_id = public.my_org_id(auth.uid()));
CREATE POLICY "Client users can insert own org activity" ON public.activity_events FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id(auth.uid()) AND user_id = auth.uid());

-- 3) support_tickets table
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to support_tickets" ON public.support_tickets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Client users can view own org tickets" ON public.support_tickets FOR SELECT TO authenticated
  USING (org_id = public.my_org_id(auth.uid()));
CREATE POLICY "Client users can create tickets" ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id(auth.uid()) AND created_by = auth.uid());

-- 4) billing_records table (admin-only)
CREATE TABLE public.billing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount_paid numeric NOT NULL,
  currency text DEFAULT 'USD',
  paid_at timestamptz NOT NULL,
  payment_method text DEFAULT 'manual',
  invoice_ref text,
  internal_notes text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to billing_records" ON public.billing_records FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 5) plan_entitlements table
CREATE TABLE public.plan_entitlements (
  plan_name text PRIMARY KEY,
  ai_enabled boolean DEFAULT true,
  exports_enabled boolean DEFAULT true,
  pdf_enabled boolean DEFAULT true,
  months_editable integer DEFAULT 1
);
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plan_entitlements" ON public.plan_entitlements FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins can manage plan_entitlements" ON public.plan_entitlements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Seed entitlements
INSERT INTO public.plan_entitlements (plan_name, ai_enabled, exports_enabled, pdf_enabled, months_editable) VALUES
  ('Starter', true, true, true, 1),
  ('Custom', true, true, true, 1),
  ('Trial', true, true, true, 1),
  ('Active', true, true, true, 1),
  ('Suspended', false, false, false, 0),
  ('Expired', false, false, false, 0);
