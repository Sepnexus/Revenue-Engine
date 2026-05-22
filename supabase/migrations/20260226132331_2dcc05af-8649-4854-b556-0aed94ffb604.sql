
-- Harden save_kpi_revision trigger with org ownership check
CREATE OR REPLACE FUNCTION public.save_kpi_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify the caller belongs to this org (or is admin)
  IF NOT (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized revision save';
  END IF;

  IF OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO public.kpi_period_revisions (kpi_period_id, org_id, data, edited_by)
    VALUES (OLD.id, OLD.org_id, OLD.data, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
