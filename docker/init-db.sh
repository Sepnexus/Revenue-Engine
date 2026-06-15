#!/usr/bin/env bash
# Database-only first-boot initialization.
# Idempotent: no-ops if cluster already exists (just replays any new
# migration files). Seeding/restore happens manually after first boot
# via scripts/restore-from-lovable.sh.

set -euo pipefail

PGDATA=/var/lib/postgresql/data
SOCKETDIR=/var/run/postgresql
PGBIN=/usr/lib/postgresql/15/bin

mkdir -p "$SOCKETDIR"
chown -R postgres:postgres "$PGDATA" "$SOCKETDIR" 2>/dev/null || true

log() { echo "[init-db] $*"; }

# ─── Existing cluster: just try to apply any new migrations and exit ──
if [ -s "$PGDATA/PG_VERSION" ]; then
  log "existing Postgres cluster detected; replaying migrations (idempotent)"

  # Start with pg_cron + pg_net preloaded so CREATE EXTENSION + the
  # cron-scheduling migrations succeed. Passed via -o (command line), never
  # written to the volume — keeps rollback safe.
  su -s /bin/bash postgres -c \
    "$PGBIN/pg_ctl -D $PGDATA -l $PGDATA/migrate-server.log -w start \
       -o \"-c shared_preload_libraries='pg_cron,pg_net' -c cron.database_name='${POSTGRES_DB:-revenue_engine}' -c pg_net.database_name='${POSTGRES_DB:-revenue_engine}'\"" \
    >/dev/null

  # Enable the extensions in the app DB BEFORE migrations run, using their
  # DEFAULT schemas (net, cron) — this is what our code references and matches
  # local dev. A later Lovable migration also CREATE EXTENSION IF NOT EXISTS;
  # creating them here first makes that a no-op so the schema stays correct.
  log "  ensuring pg_net + pg_cron extensions"
  su -s /bin/bash postgres -c \
    "psql -h $SOCKETDIR -U postgres -d ${POSTGRES_DB:-revenue_engine} -v ON_ERROR_STOP=0 \
       -c 'CREATE EXTENSION IF NOT EXISTS pg_net;' \
       -c 'CREATE EXTENSION IF NOT EXISTS pg_cron;'" \
    >/dev/null 2>&1 || log "  (extension creation reported an issue — continuing)"

  for f in /docker-init/migrations/*.sql; do
    [ -f "$f" ] || continue
    log "  ↳ $(basename "$f")"
    su -s /bin/bash postgres -c \
      "psql -h $SOCKETDIR -U postgres -d ${POSTGRES_DB:-revenue_engine} -v ON_ERROR_STOP=0 -f $f" \
      >/dev/null 2>&1 || true
  done
  su -s /bin/bash postgres -c "$PGBIN/pg_ctl -D $PGDATA -m fast stop" >/dev/null
  log "migration replay done"
  exit 0
fi

# ─── Fresh cluster ───────────────────────────────────────────
log "fresh cluster — initializing"

su -s /bin/bash postgres -c \
  "$PGBIN/initdb -D $PGDATA --auth-host=md5 --auth-local=trust -E UTF8 --locale=C.UTF-8"

cat >> "$PGDATA/pg_hba.conf" <<EOF
host all all 127.0.0.1/32 md5
host all all ::1/128      md5
EOF

cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
unix_socket_directories = '$SOCKETDIR'
EOF

log "starting Postgres for init (with pg_cron + pg_net preloaded)"
su -s /bin/bash postgres -c \
  "$PGBIN/pg_ctl -D $PGDATA -l $PGDATA/init-server.log -w start \
     -o \"-c shared_preload_libraries='pg_cron,pg_net' -c cron.database_name='${POSTGRES_DB:-revenue_engine}' -c pg_net.database_name='${POSTGRES_DB:-revenue_engine}'\""

# Wait for it to actually accept queries
for i in $(seq 1 30); do
  if su -s /bin/bash postgres -c \
       "psql -h $SOCKETDIR -U postgres -d postgres -c 'select 1'" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

PSQL_AS_PG() {
  su -s /bin/bash postgres -c \
    "psql -h $SOCKETDIR -U postgres -d ${2:-postgres} -v ON_ERROR_STOP=1 $1"
}

log "setting postgres superuser password and creating app database"
PSQL_AS_PG "-c \"alter user postgres with password '$POSTGRES_PASSWORD';\" -c \"create database $POSTGRES_DB;\""

log "bootstrapping roles + auth schema (schema-init.sql)"
PSQL_AS_PG \
  "-c \"set app.authenticator_password = '$AUTHENTICATOR_PASSWORD';\" \
   -c \"set app.auth_admin_password    = '$AUTH_ADMIN_PASSWORD';\" \
   -f /docker-init/schema-init.sql" \
  "$POSTGRES_DB"

log "running GoTrue migrations (creates auth.users etc.)"
API_EXTERNAL_URL="$SITE_URL" \
GOTRUE_DB_MIGRATIONS_PATH=/usr/local/etc/auth/migrations \
GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${AUTH_ADMIN_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?search_path=auth" \
GOTRUE_JWT_SECRET="$JWT_SECRET" \
GOTRUE_SITE_URL="$SITE_URL" \
GOTRUE_API_HOST=127.0.0.1 \
GOTRUE_API_PORT=9999 \
GOTRUE_DB_DRIVER=postgres \
  /usr/local/bin/auth migrate

log "ensuring pg_net + pg_cron extensions (default schemas net, cron)"
# Non-fatal: a fresh deploy must still come up even if extension creation has
# an issue — the app's auth/dashboards don't depend on these; only GHL does.
su -s /bin/bash postgres -c \
  "psql -h $SOCKETDIR -U postgres -d $POSTGRES_DB -v ON_ERROR_STOP=0 \
     -c 'CREATE EXTENSION IF NOT EXISTS pg_net;' \
     -c 'CREATE EXTENSION IF NOT EXISTS pg_cron;'" \
  || log "  (extension creation reported an issue — continuing)"

log "applying user migrations"
for f in /docker-init/migrations/*.sql; do
  [ -f "$f" ] || continue
  log "  ↳ $(basename "$f")"
  PSQL_AS_PG "-f $f" "$POSTGRES_DB"
done

log "running post-migrations.sql (grants for PostgREST)"
PSQL_AS_PG "-f /docker-init/post-migrations.sql" "$POSTGRES_DB"

log "stopping init Postgres (start.sh will boot it for real)"
su -s /bin/bash postgres -c "$PGBIN/pg_ctl -D $PGDATA -m fast stop"

log "init complete"
