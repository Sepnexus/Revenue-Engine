-- ============================================================================
-- Per-org channel definitions: the unit of GHL → Revenue Engine mapping.
--
-- Each row is one channel (e.g. "Cold Calling") that owns:
--   • the source/tag/custom-field values from GHL contacts that count as
--     belonging to this channel
--   • the pipeline stages (by stage_id) that represent each funnel milestone
--     for opps in this channel
--   • a default manual spend (admin can still override per-month)
--
-- Sync logic then iterates each channel × each month, computing:
--   newLeads   = contacts in this channel created that month
--   netLeads   = opps in those contacts whose current stage ∈ net_stage_ids
--   offers     = opps whose current stage ∈ offer_stage_ids
--   contracts  = opps whose current stage ∈ contract_stage_ids
--   closedDeals/closedRevenue = opps with status='won' that month
--   spend      = COALESCE(manual override, default_spend, 0)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.org_channels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  display_order     INT  NOT NULL DEFAULT 0,

  -- Source matching: which GHL contact attributes count as this channel.
  -- Shape: { "sources": ["..."], "tags": ["..."],
  --          "custom_fields": [ {"field_id":"...", "values":["..."]}, ... ] }
  source_rules      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Pipeline stage assignments for the funnel.
  -- Each is an array of pipeline_stage_id (UUIDs from GHL).
  net_stage_ids       TEXT[] NOT NULL DEFAULT '{}',
  offer_stage_ids     TEXT[] NOT NULL DEFAULT '{}',
  contract_stage_ids  TEXT[] NOT NULL DEFAULT '{}',

  -- Optional defaults
  default_spend     NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active         BOOLEAN       NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS org_channels_org_idx ON public.org_channels (org_id, display_order);

ALTER TABLE public.org_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to org_channels" ON public.org_channels;
CREATE POLICY "Admins full access to org_channels"
  ON public.org_channels FOR ALL
  USING       (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK  (has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Client users can view own org channels" ON public.org_channels;
CREATE POLICY "Client users can view own org channels"
  ON public.org_channels FOR SELECT
  USING (org_id = my_org_id(auth.uid()));

GRANT SELECT                         ON public.org_channels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_channels TO service_role;

-- updated_at trigger (drop+recreate so it's idempotent)
DROP TRIGGER IF EXISTS org_channels_set_updated_at ON public.org_channels;
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER org_channels_set_updated_at
  BEFORE UPDATE ON public.org_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Seed three default channels for any GHL-active org that has none ──────
-- Idempotent: only inserts if org has no channels yet.
CREATE OR REPLACE FUNCTION public.ghl_seed_default_channels(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count INT;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT count(*) INTO v_count FROM public.org_channels WHERE org_id = p_org_id;
  IF v_count > 0 THEN RETURN 0; END IF;

  INSERT INTO public.org_channels (org_id, name, display_order, source_rules) VALUES
    (p_org_id, 'Cold Calling',  1, '{"sources":[],"tags":[],"custom_fields":[]}'::jsonb),
    (p_org_id, 'Direct Mail',   2, '{"sources":[],"tags":[],"custom_fields":[]}'::jsonb),
    (p_org_id, 'PPC / Google',  3, '{"sources":[],"tags":[],"custom_fields":[]}'::jsonb);
  RETURN 3;
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_seed_default_channels(UUID) TO authenticated;

-- ─── Save/upsert a channel ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ghl_save_channel(
  p_org_id           UUID,
  p_channel_id       UUID,                 -- NULL = create
  p_name             TEXT,
  p_source_rules     JSONB,
  p_net_stage_ids    TEXT[],
  p_offer_stage_ids  TEXT[],
  p_contract_stage_ids TEXT[],
  p_default_spend    NUMERIC DEFAULT 0,
  p_display_order    INT     DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  IF p_channel_id IS NULL THEN
    INSERT INTO public.org_channels (
      org_id, name, source_rules, net_stage_ids, offer_stage_ids,
      contract_stage_ids, default_spend, display_order
    ) VALUES (
      p_org_id, p_name, COALESCE(p_source_rules, '{}'::jsonb),
      COALESCE(p_net_stage_ids, '{}'), COALESCE(p_offer_stage_ids, '{}'),
      COALESCE(p_contract_stage_ids, '{}'), COALESCE(p_default_spend, 0),
      COALESCE(p_display_order, (SELECT COALESCE(max(display_order),0)+1 FROM public.org_channels WHERE org_id = p_org_id))
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.org_channels SET
      name              = p_name,
      source_rules      = COALESCE(p_source_rules, source_rules),
      net_stage_ids     = COALESCE(p_net_stage_ids, net_stage_ids),
      offer_stage_ids   = COALESCE(p_offer_stage_ids, offer_stage_ids),
      contract_stage_ids = COALESCE(p_contract_stage_ids, contract_stage_ids),
      default_spend     = COALESCE(p_default_spend, default_spend),
      display_order     = COALESCE(p_display_order, display_order)
    WHERE id = p_channel_id AND org_id = p_org_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_save_channel(UUID, UUID, TEXT, JSONB, TEXT[], TEXT[], TEXT[], NUMERIC, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ghl_delete_channel(p_org_id UUID, p_channel_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  DELETE FROM public.org_channels WHERE id = p_channel_id AND org_id = p_org_id;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.ghl_delete_channel(UUID, UUID) TO authenticated;
