ALTER TABLE public.plan_entitlements
  ADD COLUMN IF NOT EXISTS team_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS financials_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS history_enabled boolean DEFAULT true;