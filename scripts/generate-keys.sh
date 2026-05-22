#!/usr/bin/env bash
# Generates a JWT_SECRET (or reuses an existing one) and prints the matching
# anon + service_role JWTs so you can paste them into infra/.env.
#
# Usage:
#   scripts/generate-keys.sh                # generate a fresh secret
#   JWT_SECRET=<existing-secret> scripts/generate-keys.sh   # reuse Lovable's
#
# Requires: openssl, node (or python3).

set -euo pipefail

SECRET="${JWT_SECRET:-$(openssl rand -base64 48 | tr -d '\n=' | cut -c1-64)}"
EXP_YEARS=10
IAT=$(date +%s)
EXP=$((IAT + EXP_YEARS * 365 * 24 * 3600))

if command -v node >/dev/null 2>&1; then
  sign() {
    local role="$1"
    node -e "
      const c=require('crypto');
      const b64=(o)=>Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64url');
      const h=b64({alg:'HS256',typ:'JWT'});
      const p=b64({role:'$role',iss:'supabase',iat:$IAT,exp:$EXP});
      const s=c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url');
      process.stdout.write(h+'.'+p+'.'+s);
    "
  }
else
  echo "node is required" >&2; exit 1
fi

ANON=$(sign anon)
SERVICE=$(sign service_role)

cat <<EOF
JWT_SECRET=$SECRET
ANON_KEY=$ANON
SERVICE_ROLE_KEY=$SERVICE
EOF
