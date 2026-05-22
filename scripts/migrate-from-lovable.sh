#!/usr/bin/env bash
# Migrate users + data from the Lovable-hosted Supabase project into a
# self-hosted Supabase (local docker-compose OR remote VPS).
#
# This preserves:
#   - user IDs (so all FKs in `public` still resolve)
#   - bcrypt password hashes (users log in with their existing passwords)
#   - storage metadata (object rows in `storage.objects`)
#
# It does NOT copy storage *file contents* — run scripts/sync-storage.sh for that.
#
# Usage:
#   SOURCE_DB_URL="postgres://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres" \
#   TARGET_DB_URL="postgres://postgres:<pwd>@localhost:5432/postgres" \
#   scripts/migrate-from-lovable.sh
#
# Get SOURCE_DB_URL from the Lovable Supabase dashboard:
#   Project Settings → Database → Connection string (URI).

set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL to the Lovable Supabase connection string}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL to your self-hosted Supabase connection string}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
DUMP="$OUT_DIR/lovable-$STAMP.sql"

echo "==> Dumping auth + storage + public from source"
pg_dump \
  --no-owner --no-privileges \
  --quote-all-identifiers \
  --schema=auth --schema=storage --schema=public \
  --exclude-table-data='auth.audit_log_entries' \
  --exclude-table-data='auth.flow_state' \
  --exclude-table-data='auth.sessions' \
  --exclude-table-data='auth.refresh_tokens' \
  "$SOURCE_DB_URL" > "$DUMP"

echo "==> Dump written to $DUMP ($(du -h "$DUMP" | cut -f1))"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN=1 — stopping before restore."
  exit 0
fi

echo "==> Restoring into target"
# --single-transaction so a failure leaves nothing partial
psql --single-transaction --variable=ON_ERROR_STOP=1 "$TARGET_DB_URL" < "$DUMP"

echo "==> Done. Verify with:"
echo "    psql \"\$TARGET_DB_URL\" -c 'select count(*) from auth.users;'"
