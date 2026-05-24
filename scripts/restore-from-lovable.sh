#!/usr/bin/env bash
# Restore a Lovable Cloud export into the running single-container
# Revenue Engine database. Run AFTER the container is up.
#
# Files expected at:
#   backups/full-database-export.sql   (Lovable: "Generate full database export")
#   backups/auth-users-export.sql      (Lovable: auth.users dump with bcrypt hashes)
#
# Run:
#   ./scripts/restore-from-lovable.sh
#
# Env (override if your container/db differs):
#   APP_CONTAINER  default: revenue-engine
#   POSTGRES_DB    read from .env if present, else revenue_engine

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS="$ROOT/backups"
APP_CONTAINER="${APP_CONTAINER:-revenue-engine}"

# Read POSTGRES_DB + POSTGRES_PASSWORD from .env if it exists
if [ -f "$ROOT/.env" ]; then
  POSTGRES_DB=$(grep -E '^POSTGRES_DB=' "$ROOT/.env" | cut -d= -f2- || true)
  POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' "$ROOT/.env" | cut -d= -f2- || true)
fi
: "${POSTGRES_DB:=revenue_engine}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set (in .env or env var)}"

PUBLIC_SRC="$BACKUPS/full-database-export.sql"
AUTH_SRC="$BACKUPS/auth-users-export.sql"

test -f "$PUBLIC_SRC" || { echo "missing: $PUBLIC_SRC"; exit 1; }
test -f "$AUTH_SRC"   || { echo "missing: $AUTH_SRC";   exit 1; }

# ── Fix Lovable's two export quirks before applying ───
PUBLIC_FIX="$BACKUPS/full-database-export.fixed.sql"
AUTH_FIX="$BACKUPS/auth-users-export.fixed.sql"

# auth.users export includes `confirmed_at` (a generated column in current
# GoTrue). Strip it from the INSERT column list and the matching value.
sed -E \
  -e 's/, confirmed_at\)/)/g' \
  -e "s/, '[^']*'::timestamptz\\);/);/" \
  -e 's/, NULL\);$/);/' \
  "$AUTH_SRC" > "$AUTH_FIX"

# Lovable emits `CREATE POLICY ... TO  USING ...` with an empty role list
# for policies targeting all roles. Rewrite to `TO public`.
sed -E \
  -e 's/ FOR ([A-Z]+) TO  USING/ FOR \1 TO public USING/g' \
  -e 's/ FOR ([A-Z]+) TO  WITH/ FOR \1 TO public WITH/g' \
  "$PUBLIC_SRC" > "$PUBLIC_FIX"

EXEC() {
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$APP_CONTAINER" \
    psql -h 127.0.0.1 -U postgres -d "$POSTGRES_DB" "$@"
}

# ─── Wipe + restore ───────────────────────────────────
echo "==> Wiping public schema and auth.users (no auth.users → no on_auth_user_created trigger fires)"
EXEC -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DELETE FROM auth.users;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL   ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL

echo "==> Importing auth.users (preserves bcrypt password hashes)"
EXEC -v ON_ERROR_STOP=1 >/dev/null < "$AUTH_FIX"

echo "==> Importing public schema + data"
EXEC -v ON_ERROR_STOP=1 >/dev/null < "$PUBLIC_FIX"

echo "==> Re-applying grants so PostgREST can serve the freshly-created tables"
EXEC -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
SQL

echo "==> Row counts:"
EXEC -At -F $'\t' <<'SQL'
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

echo "==> Done. Try a real-user login at: $(grep ^SITE_URL "$ROOT/.env" | cut -d= -f2-)"
