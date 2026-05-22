
-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to auto-expire subscriptions past their expiry date
CREATE OR REPLACE FUNCTION public.auto_expire_subscriptions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.subscriptions
  SET plan_status = 'expired',
      updated_at = now()
  WHERE plan_status IN ('active', 'trial')
    AND expires_at IS NOT NULL
    AND expires_at < now();
END;
$$;
