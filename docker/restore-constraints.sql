-- Re-create primary keys, unique indexes, and foreign keys that Lovable's
-- data-only export strips out. Source of truth: supabase/migrations/*.sql.
--
-- Every statement is wrapped in its own DO block with broad exception
-- handling so this script is:
--   • idempotent (rerunning is a no-op if everything's already in place)
--   • robust to schema drift (a missing column on one table doesn't halt
--     the rest of the constraint restoration)
--   • robust to orphan data (we clean orphans before each FK; if cleanup
--     can't fix it, we skip and log)
--
-- Run with:
--   docker exec -i -e PGPASSWORD=... revenue-engine psql ... < restore-constraints.sql
-- Or via scripts/restore-from-lovable.sh which calls this automatically.

\set ON_ERROR_STOP off
\set QUIET on

-- ─── Helper: try-create constraint, ignore "already exists" and similar ──
CREATE OR REPLACE FUNCTION pg_temp.try_constraint(sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE '  ✓ %', sql;
EXCEPTION
  WHEN duplicate_object  THEN RAISE NOTICE '  · skip (exists): %', sql;
  WHEN duplicate_table   THEN RAISE NOTICE '  · skip (exists): %', sql;
  WHEN undefined_column  THEN RAISE NOTICE '  · skip (no column): %', sql;
  WHEN undefined_table   THEN RAISE NOTICE '  · skip (no table): %', sql;
  WHEN foreign_key_violation THEN RAISE NOTICE '  ✗ orphan data: %', sql;
  WHEN others            THEN RAISE NOTICE '  ✗ %: %', SQLERRM, sql;
END $$;

-- ─── Orphan cleanup: NULL out (or DELETE) rows pointing to missing parents ──
-- Done BEFORE adding FKs so the constraints can be created cleanly.
\echo ''
\echo '== Cleaning orphan FK references =='

DO $$
DECLARE
  cleanup record;
BEGIN
  -- (target_table, target_col, parent_table, parent_col, action: 'null'|'delete')
  FOR cleanup IN SELECT * FROM (VALUES
    ('audit_logs',          'org_id',          'organizations',      'id', 'null'),
    ('audit_logs',          'actor_user_id',   'auth.users',         'id', 'null'),
    ('subscription_events', 'org_id',          'organizations',      'id', 'null'),
    ('ai_usage_logs',       'org_id',          'organizations',      'id', 'null'),
    ('ai_usage_logs',       'user_id',         'auth.users',         'id', 'null'),
    ('ai_usage_logs',       'conversation_id', 'chat_conversations', 'id', 'null'),
    ('activity_events',     'org_id',          'organizations',      'id', 'null'),
    ('activity_events',     'user_id',         'auth.users',         'id', 'null'),
    ('support_tickets',     'org_id',          'organizations',      'id', 'delete'),
    ('org_settings',        'org_id',          'organizations',      'id', 'delete'),
    ('chat_messages',       'conversation_id', 'chat_conversations', 'id', 'delete'),
    ('chat_messages',       'org_id',          'organizations',      'id', 'delete'),
    ('kpi_period_revisions','kpi_period_id',   'kpi_periods',        'id', 'delete'),
    ('kpi_period_revisions','org_id',          'organizations',      'id', 'delete'),
    ('profiles',            'org_id',          'organizations',      'id', 'null'),
    ('user_roles',          'user_id',         'auth.users',         'id', 'delete')
  ) AS t(target_table, target_col, parent_table, parent_col, action)
  LOOP
    BEGIN
      IF cleanup.action = 'null' THEN
        EXECUTE format(
          'UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL AND %I NOT IN (SELECT %I FROM %s)',
          cleanup.target_table, cleanup.target_col, cleanup.target_col, cleanup.target_col,
          cleanup.parent_col, cleanup.parent_table);
      ELSE
        EXECUTE format(
          'DELETE FROM public.%I WHERE %I IS NOT NULL AND %I NOT IN (SELECT %I FROM %s)',
          cleanup.target_table, cleanup.target_col, cleanup.target_col,
          cleanup.parent_col, cleanup.parent_table);
      END IF;
    EXCEPTION
      WHEN undefined_column THEN NULL;  -- column doesn't exist on this DB
      WHEN undefined_table  THEN NULL;
      WHEN not_null_violation THEN
        EXECUTE format('DELETE FROM public.%I WHERE %I NOT IN (SELECT %I FROM %s)',
          cleanup.target_table, cleanup.target_col, cleanup.parent_col, cleanup.parent_table);
    END;
  END LOOP;
END $$;

\echo ''
\echo '== Creating PRIMARY KEYs =='

SELECT pg_temp.try_constraint('ALTER TABLE public.organizations        ADD CONSTRAINT organizations_pkey         PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.profiles             ADD CONSTRAINT profiles_pkey              PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.user_roles           ADD CONSTRAINT user_roles_pkey            PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.subscriptions        ADD CONSTRAINT subscriptions_pkey         PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_periods          ADD CONSTRAINT kpi_periods_pkey           PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_period_revisions ADD CONSTRAINT kpi_period_revisions_pkey  PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.billing_records      ADD CONSTRAINT billing_records_pkey       PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.chat_conversations   ADD CONSTRAINT chat_conversations_pkey    PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.chat_messages        ADD CONSTRAINT chat_messages_pkey         PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.audit_logs           ADD CONSTRAINT audit_logs_pkey            PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.access_requests      ADD CONSTRAINT access_requests_pkey       PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.support_tickets      ADD CONSTRAINT support_tickets_pkey       PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.subscription_events  ADD CONSTRAINT subscription_events_pkey   PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.ai_usage_logs        ADD CONSTRAINT ai_usage_logs_pkey         PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.activity_events      ADD CONSTRAINT activity_events_pkey       PRIMARY KEY (id)');
-- org_settings has either an id column (older schema) or uses org_id as PK; try both, one will skip.
SELECT pg_temp.try_constraint('ALTER TABLE public.org_settings         ADD CONSTRAINT org_settings_pkey          PRIMARY KEY (id)');
SELECT pg_temp.try_constraint('ALTER TABLE public.org_settings         ADD CONSTRAINT org_settings_pkey          PRIMARY KEY (org_id)');
-- plans uses plan_name as PK
SELECT pg_temp.try_constraint('ALTER TABLE public.plans                ADD CONSTRAINT plans_pkey                 PRIMARY KEY (plan_name)');

\echo ''
\echo '== Creating UNIQUE constraints =='

SELECT pg_temp.try_constraint('ALTER TABLE public.organizations ADD CONSTRAINT organizations_slug_key       UNIQUE (slug)');
SELECT pg_temp.try_constraint('ALTER TABLE public.user_roles    ADD CONSTRAINT user_roles_user_role_key     UNIQUE (user_id, role)');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_periods   ADD CONSTRAINT kpi_periods_org_period_unique UNIQUE (org_id, period_start)');
SELECT pg_temp.try_constraint('ALTER TABLE public.org_settings  ADD CONSTRAINT org_settings_org_id_key       UNIQUE (org_id)');

\echo ''
\echo '== Creating FOREIGN KEYs to organizations =='

SELECT pg_temp.try_constraint('ALTER TABLE public.profiles             ADD CONSTRAINT profiles_org_id_fkey             FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.subscriptions        ADD CONSTRAINT subscriptions_org_id_fkey        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_periods          ADD CONSTRAINT kpi_periods_org_id_fkey          FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_period_revisions ADD CONSTRAINT kpi_period_revisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.billing_records      ADD CONSTRAINT billing_records_org_id_fkey      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.chat_conversations   ADD CONSTRAINT chat_conversations_org_id_fkey   FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.chat_messages        ADD CONSTRAINT chat_messages_org_id_fkey        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.audit_logs           ADD CONSTRAINT audit_logs_org_id_fkey           FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.support_tickets      ADD CONSTRAINT support_tickets_org_id_fkey      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.subscription_events  ADD CONSTRAINT subscription_events_org_id_fkey  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.ai_usage_logs        ADD CONSTRAINT ai_usage_logs_org_id_fkey        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.org_settings         ADD CONSTRAINT org_settings_org_id_fkey         FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.activity_events      ADD CONSTRAINT activity_events_org_id_fkey      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE');

\echo ''
\echo '== Creating FOREIGN KEYs to auth.users =='

SELECT pg_temp.try_constraint('ALTER TABLE public.profiles        ADD CONSTRAINT profiles_id_fkey            FOREIGN KEY (id)            REFERENCES auth.users(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.user_roles      ADD CONSTRAINT user_roles_user_id_fkey     FOREIGN KEY (user_id)       REFERENCES auth.users(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.audit_logs      ADD CONSTRAINT audit_logs_actor_user_fkey  FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.activity_events ADD CONSTRAINT activity_events_user_fkey   FOREIGN KEY (user_id)       REFERENCES auth.users(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.ai_usage_logs   ADD CONSTRAINT ai_usage_logs_user_fkey     FOREIGN KEY (user_id)       REFERENCES auth.users(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_periods     ADD CONSTRAINT kpi_periods_created_by_fkey FOREIGN KEY (created_by)    REFERENCES auth.users(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.organizations   ADD CONSTRAINT organizations_created_by_fk FOREIGN KEY (created_by)    REFERENCES auth.users(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.org_settings    ADD CONSTRAINT org_settings_updated_by_fk  FOREIGN KEY (updated_by)    REFERENCES auth.users(id) ON DELETE SET NULL');

\echo ''
\echo '== Creating other parent-child FOREIGN KEYs =='

SELECT pg_temp.try_constraint('ALTER TABLE public.chat_messages         ADD CONSTRAINT chat_messages_conversation_fkey     FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE');
SELECT pg_temp.try_constraint('ALTER TABLE public.ai_usage_logs         ADD CONSTRAINT ai_usage_logs_conversation_fkey     FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE SET NULL');
SELECT pg_temp.try_constraint('ALTER TABLE public.kpi_period_revisions  ADD CONSTRAINT kpi_period_revisions_period_fkey    FOREIGN KEY (kpi_period_id)   REFERENCES public.kpi_periods(id)        ON DELETE CASCADE');

-- Tell PostgREST to re-introspect the schema cache so embedded queries
-- (e.g. organizations?select=*,subscriptions(*)) start working immediately.
\echo ''
\echo '== Reloading PostgREST schema cache =='
NOTIFY pgrst, 'reload schema';

\echo ''
\echo 'Done. Hard-refresh the app and embedded queries should resolve.'
