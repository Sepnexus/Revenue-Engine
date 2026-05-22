#!/usr/bin/env bash
# Reads JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY from $1 and writes them
# into infra/.env, replacing any existing values.
set -euo pipefail
SRC="${1:?path to keys file}"
DEST="infra/.env"
test -f "$DEST" || { echo "$DEST missing — run 'make bootstrap' first"; exit 1; }
while IFS='=' read -r key val; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # escape sed delimiter
  esc=$(printf '%s' "$val" | sed -e 's/[\/&|]/\\&/g')
  if grep -q "^$key=" "$DEST"; then
    sed -i.bak "s|^$key=.*|$key=$esc|" "$DEST"
  else
    echo "$key=$val" >> "$DEST"
  fi
done < "$SRC"
rm -f "$DEST.bak"
echo "Updated $DEST"
