#!/usr/bin/env bash
# Restore a Lovable Cloud export into a self-hosted Supabase.
#
# Lovable's "Generate full database export" produces two files we work with:
#
#   backups/full-database-export.sql  — public schema (tables, data, RLS,
#                                       functions, triggers, enums)
#   backups/auth-users-export.sql     — auth.users rows including the
#                                       bcrypt-hashed encrypted_password
#
# Both files are exported by Lovable in formats that need small fixes before
# they restore cleanly into a stock Supabase Postgres:
#
#   1. auth.users export includes the `confirmed_at` column, which is a
#      generated column in current GoTrue. We strip it from the INSERTs.
#   2. The public-schema export emits `CREATE POLICY ... TO  USING ...`
#      with an empty role list when the policy targets all roles. Postgres
#      rejects that — we rewrite it as `TO public`.
#
# This script wipes the local public schema + auth.users, applies both
# exports in the correct order (auth.users first so no profile-creation
# trigger fires), and verifies the row counts.
#
# Usage:
#   make restore-from-lovable
# or:
#   ./scripts/restore-from-lovable.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS="$ROOT/backups"
ENV_FILE="$ROOT/infra/.env"
DB_CONTAINER="${DB_CONTAINER:-metrics-loom-db-1}"

PUBLIC_SRC="$BACKUPS/full-database-export.sql"
AUTH_SRC="$BACKUPS/auth-users-export.sql"

test -f "$PUBLIC_SRC" || { echo "missing: $PUBLIC_SRC"; exit 1; }
test -f "$AUTH_SRC"   || { echo "missing: $AUTH_SRC";   exit 1; }
test -f "$ENV_FILE"   || { echo "missing: $ENV_FILE — run 'make bootstrap' first"; exit 1; }

PW=$(grep ^POSTGRES_PASSWORD= "$ENV_FILE" | cut -d= -f2-)

# ---- step 1: rewrite the two exports into clean .fixed.sql files ----
PUBLIC_FIX="$BACKUPS/full-database-export.fixed.sql"
AUTH_FIX="$BACKUPS/auth-users-export.fixed.sql"

# Strip the generated `confirmed_at` column from the auth.users INSERTs.
sed -E \
  -e 's/, confirmed_at\)/)/g' \
  -e "s/, '[^']*'::timestamptz\\);/);/" \
  -e 's/, NULL\);$/);/' \
  "$AUTH_SRC" > "$AUTH_FIX"

# Replace empty `TO  USING` / `TO  WITH` clauses with `TO public`.
sed -E \
  -e 's/ FOR ([A-Z]+) TO  USING/ FOR \1 TO public USING/g' \
  -e 's/ FOR ([A-Z]+) TO  WITH/ FOR \1 TO public WITH/g' \
  "$PUBLIC_SRC" > "$PUBLIC_FIX"

# ---- step 2: wipe local DB ----
echo "==> Wiping public schema and auth.users on $DB_CONTAINER"
docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DELETE FROM auth.users;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL

# ---- step 3: restore auth.users (must be before public schema so the
# on_auth_user_created trigger doesn't fire) ----
echo "==> Importing auth.users"
docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$AUTH_FIX" >/dev/null

# ---- step 4: restore public schema (tables, data, RLS, functions, triggers) ----
echo "==> Importing public schema + data"
docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$PUBLIC_FIX" >/dev/null

# ---- step 5: verify ----
echo "==> Row counts:"
docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
  psql -U postgres -d postgres -At -F $'\t' <<'SQL'
SELECT 'auth.users',         count(*) FROM auth.users;
SELECT 'organizations',      count(*) FROM public.organizations;
SELECT 'profiles',           count(*) FROM public.profiles;
SELECT 'user_roles',         count(*) FROM public.user_roles;
SELECT 'subscriptions',      count(*) FROM public.subscriptions;
SELECT 'kpi_periods',        count(*) FROM public.kpi_periods;
SELECT 'chat_conversations', count(*) FROM public.chat_conversations;
SELECT 'chat_messages',      count(*) FROM public.chat_messages;
SELECT 'billing_records',    count(*) FROM public.billing_records;
SELECT 'audit_logs',         count(*) FROM public.audit_logs;
SELECT 'access_requests',    count(*) FROM public.access_requests;
SELECT 'rls_policies',       count(*) FROM pg_policies WHERE schemaname='public';
SQL

echo "==> Done. Try a login at http://localhost:8000/auth/v1/token?grant_type=password"
