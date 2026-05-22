# Metrics Loom — self-hosted monorepo

Single repo that contains everything needed to run this product end-to-end
on your own infrastructure: the frontend, the full Supabase stack
(Postgres + Auth + REST + Storage + Studio), infra (docker-compose + Caddy),
and the migration tooling for moving off Lovable without disrupting users.

## Layout

```
apps/web/          Vite + React + shadcn frontend (from Lovable)
supabase/          DB migrations, edge functions, config.toml
infra/             docker-compose for the Supabase stack, Caddy for prod TLS
scripts/           Migration + key-generation helpers
```

## Quick start (local dev)

Prereqs: Docker, Bun (or npm), `psql` + `pg_dump` 15+, `openssl`, Node.

```bash
make bootstrap         # creates infra/.env + apps/web/.env with fresh keys
make dev               # boots Postgres, Auth, REST, Storage, Studio, mail
make dev-web           # runs the Vite frontend at http://localhost:5173
```

Endpoints:

| service | URL                     |
|---------|-------------------------|
| Frontend | http://localhost:5173  |
| Supabase API (Kong) | http://localhost:8000 |
| Supabase Studio | http://localhost:3000 |
| Mail catcher (Inbucket) | http://localhost:9000 |

`make psql` drops you into the local DB. `make logs` tails the stack.

## Migrating off Lovable (the seamless path)

The goal: users log into the new system with their existing email +
password, with no reset and ideally no re-login.

1. **Grab Lovable's JWT secret** (Supabase dashboard → Settings → API →
   JWT Secret). Put it in `infra/.env` as `JWT_SECRET` *before* generating
   anon/service-role keys. Reusing this secret keeps existing access tokens
   valid through cutover.
2. **Generate matching keys** for that secret:
   ```bash
   JWT_SECRET="<the-lovable-secret>" scripts/generate-keys.sh
   ```
   Paste the output into `infra/.env`.
3. **Dump + restore**:
   ```bash
   SOURCE_DB_URL="postgres://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres" \
   TARGET_DB_URL="postgres://postgres:<pwd>@localhost:5432/postgres" \
   make migrate-from-lovable
   ```
   This copies `auth`, `storage`, and `public` schemas — user IDs and
   bcrypt password hashes come with them.
4. **Sync storage files** (only if your app uploads files):
   ```bash
   scripts/sync-storage.sh   # see header of the script for env vars
   ```
5. **Point the frontend** at the self-hosted API by editing
   `apps/web/.env` and rebuilding.

For the real production cutover, do steps 3–5 against the VPS instead of
localhost during a short maintenance window. See `docs/cutover.md` (TBD)
for the full runbook.

## Deploying to a VPS

```bash
# on the VPS, after cloning the repo:
make bootstrap
# edit infra/.env: real JWT secret, strong POSTGRES_PASSWORD, prod URLs,
# real SMTP creds (no inbucket in prod)
# edit infra/caddy/Caddyfile with your real domains
make prod-up
make build-web         # produces apps/web/dist; Caddy serves it from web-dist volume
```

## What's intentionally not here yet

- CI workflow (`.github/workflows/deploy.yml`) — add once you've picked a deploy strategy (rsync, GHCR images, etc.)
- Automated DB backups (cron pg_dump to S3) — easy to bolt on
- Realtime + Edge Function containers — add to docker-compose when needed
