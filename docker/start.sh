#!/usr/bin/env bash
# Entrypoint. Boots Postgres + GoTrue + PostgREST + nginx inside ONE
# container. Re-runs init-db.sh (which is idempotent) on every start.

set -euo pipefail

# ─── Required env (fail fast if missing) ─────────────────
: "${POSTGRES_PASSWORD:?must be set}"
: "${POSTGRES_DB:=revenue_engine}"
: "${AUTHENTICATOR_PASSWORD:?must be set}"
: "${AUTH_ADMIN_PASSWORD:?must be set}"
: "${JWT_SECRET:?must be set (40+ char random string)}"
: "${ANON_KEY:?must be set (JWT signed with JWT_SECRET, role=anon)}"
: "${SERVICE_ROLE_KEY:?must be set (JWT signed with JWT_SECRET, role=service_role)}"
: "${SITE_URL:?must be set (e.g. https://revenue.sepnexus.com)}"

export POSTGRES_DB POSTGRES_PASSWORD AUTHENTICATOR_PASSWORD AUTH_ADMIN_PASSWORD \
       JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SITE_URL

PGBIN=/usr/lib/postgresql/15/bin
PGDATA=/var/lib/postgresql/data

# ─── First-boot DB init (idempotent) ─────────────────────
/docker-init/init-db.sh

# ─── Postgres ────────────────────────────────────────────
echo "[start] booting Postgres"
su -s /bin/bash postgres -c "$PGBIN/postgres -D $PGDATA" &
PG_PID=$!

for i in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then break; fi
  sleep 1
done

# ─── GoTrue (Supabase Auth) ──────────────────────────────
echo "[start] booting GoTrue (auth)"
API_EXTERNAL_URL="$SITE_URL" \
GOTRUE_DB_MIGRATIONS_PATH=/usr/local/etc/auth/migrations \
GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${AUTH_ADMIN_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?search_path=auth" \
GOTRUE_JWT_SECRET="$JWT_SECRET" \
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
GOTRUE_JWT_ADMIN_ROLES=service_role \
GOTRUE_JWT_AUD=authenticated \
GOTRUE_JWT_EXP=3600 \
GOTRUE_SITE_URL="$SITE_URL" \
GOTRUE_URI_ALLOW_LIST="$SITE_URL,$SITE_URL/*" \
GOTRUE_API_HOST=127.0.0.1 \
GOTRUE_API_PORT=9999 \
GOTRUE_DB_DRIVER=postgres \
GOTRUE_DISABLE_SIGNUP=true \
GOTRUE_MAILER_AUTOCONFIRM=true \
GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
GOTRUE_LOG_LEVEL=info \
  /usr/local/bin/auth serve &
GOTRUE_PID=$!

# ─── PostgREST (auto-generated REST API for public schema) ──
echo "[start] booting PostgREST"
PGRST_DB_URI="postgres://authenticator:${AUTHENTICATOR_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$JWT_SECRET" \
PGRST_SERVER_HOST=127.0.0.1 \
PGRST_SERVER_PORT=3001 \
PGRST_LOG_LEVEL=info \
  /usr/local/bin/postgrest &
PGRST_PID=$!

# ─── nginx (Supabase gateway :54321 + static frontend :3000) ──
echo "[start] booting nginx (frontend on :3000, API gateway on :54321)"
nginx -c /etc/nginx/nginx.conf &
NGINX_PID=$!

# Wait for nginx + GoTrue to actually answer
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:54321/health >/dev/null 2>&1; then break; fi
  sleep 1
done
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:54321/auth/v1/health >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[start] all 4 services up — Postgres + GoTrue + PostgREST + nginx"
echo "[start] frontend at :3000, Supabase API at :54321"

# ─── If any service dies, exit so Docker restarts the whole container ──
wait -n $PG_PID $GOTRUE_PID $PGRST_PID $NGINX_PID
echo "[start] a service exited — shutting down so Docker restarts us"
kill $PG_PID $GOTRUE_PID $PGRST_PID $NGINX_PID 2>/dev/null || true
exit 1
