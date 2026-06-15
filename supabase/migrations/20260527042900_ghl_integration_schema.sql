-- ============================================================================
-- GoHighLevel (GHL) integration — schema only.
--
-- Adds per-org pipeline/stage configuration to `public.organizations`,
-- plus three new tables:
--   `public.organization_secrets` — credentials (PIT token). Locked down so
--                                   only service_role can touch it; the
--                                   `authenticated` role has zero access.
--   `public.ghl_opportunities`    — raw mirror of opportunities pulled from GHL
--   `public.sync_state`           — per-org cursor + last-error tracking
--
-- Security model for the PIT token: we deliberately do NOT put it on
-- `organizations` with a column-level REVOKE, because column-level revokes
-- in Postgres do NOT override table-level grants. Instead the token lives
-- in `organization_secrets`, which has no GRANT to anon/authenticated at all.
-- Only edge functions (which run as service_role) can read it.
--
-- Nothing in this migration changes existing behavior. Adding all-null
-- columns is safe; the new tables are independent.
-- ============================================================================

-- ─── organizations: GHL non-secret config columns ───────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ghl_location_id           TEXT,
  ADD COLUMN IF NOT EXISTS ghl_selected_pipeline_ids TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ghl_stage_mapping         JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ghl_spend_field           TEXT,
  ADD COLUMN IF NOT EXISTS ghl_status                TEXT    NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS ghl_last_sync_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_last_sync_error       TEXT;

-- If a previous run added ghl_pit_token to organizations (early version of
-- this migration did this), strip it. The token now lives in organization_secrets.
ALTER TABLE public.organizations DROP COLUMN IF EXISTS ghl_pit_token;

-- One GHL location = one Revenue Engine org.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_ghl_location_id_unique
  ON public.organizations (ghl_location_id)
  WHERE ghl_location_id IS NOT NULL;

-- Allowed status values. CHECK avoids typos like 'Active' / 'ACTIVE'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_ghl_status_check' AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_ghl_status_check
      CHECK (ghl_status IN ('inactive', 'active', 'error'));
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.ghl_location_id IS
  'GoHighLevel Location ID. Unique per org.';
COMMENT ON COLUMN public.organizations.ghl_selected_pipeline_ids IS
  'Pipeline IDs the admin has chosen to sync. Empty array = sync none.';
COMMENT ON COLUMN public.organizations.ghl_stage_mapping IS
  'JSON: { "<pipeline_id>": { "contact": "<stage_id>", "net": "...", "offer": "...", "contract": "..." } }';
COMMENT ON COLUMN public.organizations.ghl_spend_field IS
  'GHL custom field id/key to read ad-spend from on each opportunity. NULL = leave spend manual.';

-- ─── organization_secrets: per-org credentials, service_role-only ───────────
CREATE TABLE IF NOT EXISTS public.organization_secrets (
  org_id        UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  ghl_pit_token TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organization_secrets IS
  'Holds sensitive per-org credentials. Locked down to service_role only; '
  'authenticated/anon roles have zero access. Add new credential columns here.';

ALTER TABLE public.organization_secrets ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: revoke ALL on the table from public-ish roles. We
-- also don't grant anything to them later. service_role bypasses RLS so it
-- can still operate.
REVOKE ALL ON public.organization_secrets FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.organization_secrets TO   service_role;

-- No RLS policy for anon/authenticated → they cannot SELECT/INSERT/UPDATE/DELETE.
-- (Postgres default-denies when RLS is on and no matching policy exists.)
-- A super_admin user querying via PostgREST authenticates as `authenticated`,
-- so even super_admins cannot read this table from the browser. That's
-- intentional — token reads happen inside edge functions running as
-- service_role.

-- ─── ghl_opportunities: raw mirror of GHL data ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ghl_opportunities (
  -- Composite PK: an opportunity ID is unique within a GHL location, but
  -- we key by (org_id, ghl_opportunity_id) so accidental cross-org leakage
  -- is impossible.
  org_id              UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ghl_opportunity_id  TEXT         NOT NULL,

  ghl_contact_id      TEXT,
  pipeline_id         TEXT,
  pipeline_stage_id   TEXT,
  pipeline_name       TEXT,
  stage_name          TEXT,
  status              TEXT,        -- 'open' | 'won' | 'lost' | 'abandoned'
  monetary_value      NUMERIC(14,2),
  assigned_to         TEXT,        -- GHL user id (rep)
  source              TEXT,
  name                TEXT,

  -- Raw payload + parsed-out spend field, both kept so we can re-derive KPIs
  -- without re-fetching from GHL if the mapping changes.
  custom_fields       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  spend               NUMERIC(14,2),

  ghl_created_at      TIMESTAMPTZ,
  ghl_updated_at      TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, ghl_opportunity_id)
);

CREATE INDEX IF NOT EXISTS ghl_opportunities_org_pipeline_idx
  ON public.ghl_opportunities (org_id, pipeline_id);

CREATE INDEX IF NOT EXISTS ghl_opportunities_org_updated_idx
  ON public.ghl_opportunities (org_id, ghl_updated_at DESC);

CREATE INDEX IF NOT EXISTS ghl_opportunities_org_stage_idx
  ON public.ghl_opportunities (org_id, pipeline_stage_id);

-- ─── sync_state: per-org, per-resource cursor + error tracking ──────────────
CREATE TABLE IF NOT EXISTS public.sync_state (
  org_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource               TEXT NOT NULL,           -- 'opportunities' | 'contacts' | ...
  last_full_sync_at      TIMESTAMPTZ,
  last_delta_sync_at     TIMESTAMPTZ,
  last_cursor            TEXT,                    -- GHL pagination cursor (startAfter)
  last_cursor_id         TEXT,                    -- GHL pagination cursor (startAfterId)
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  last_error_at          TIMESTAMPTZ,
  rows_synced_last_run   INTEGER,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, resource)
);

-- ─── Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.ghl_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state        ENABLE ROW LEVEL SECURITY;

-- Super admins: full access to opportunities + sync_state.
DROP POLICY IF EXISTS "Admins full access to ghl_opportunities" ON public.ghl_opportunities;
CREATE POLICY "Admins full access to ghl_opportunities"
  ON public.ghl_opportunities
  FOR ALL
  USING       (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK  (has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins full access to sync_state" ON public.sync_state;
CREATE POLICY "Admins full access to sync_state"
  ON public.sync_state
  FOR ALL
  USING       (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK  (has_role(auth.uid(), 'super_admin'::app_role));

-- Client users: read-only on their own org's opportunities (so the dashboard
-- can show pipeline data). They never see sync_state.
DROP POLICY IF EXISTS "Client users can view own org opportunities" ON public.ghl_opportunities;
CREATE POLICY "Client users can view own org opportunities"
  ON public.ghl_opportunities
  FOR SELECT
  USING (org_id = my_org_id(auth.uid()));

-- ─── Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT                          ON public.ghl_opportunities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.ghl_opportunities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.sync_state        TO service_role;
-- organization_secrets has NO grants to authenticated/anon by design.
