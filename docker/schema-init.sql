-- Bootstrap Postgres for self-hosted Supabase Auth + PostgREST.
-- Runs once on first container boot, BEFORE user migrations and
-- BEFORE GoTrue runs its own bundled migrations.

-- ─── Extensions ──────────────────────────────────────────
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ─── Supabase roles ──────────────────────────────────────
-- Anonymous (unauthenticated reads via PostgREST)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
end $$;

-- Logged-in user
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

-- Server-side (bypasses RLS) — used by admin/edge-function operations
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- PostgREST's login role; switches to anon/authenticated/service_role per request
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute format(
      'create role authenticator login password %L noinherit',
      current_setting('app.authenticator_password')
    );
  end if;
end $$;

-- GoTrue's admin role; OWNS the auth schema so it can run its own migrations
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute format(
      'create role supabase_auth_admin login password %L noinherit createrole',
      current_setting('app.auth_admin_password')
    );
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- ─── Auth schema (owned by GoTrue) ───────────────────────
-- Critical: GoTrue's bundled migrations try to CREATE OR REPLACE functions
-- in auth.*; if the schema is owned by postgres they fail with
-- "must be owner of function uid". Creating it owned by supabase_auth_admin
-- up-front is what makes the all-in-one self-hosted Supabase pattern work.
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;

-- ─── public schema privileges ────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
