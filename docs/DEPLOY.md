# Deploying Revenue Engine to the Hostinger VPS

This guide assumes:
- The VPS already runs `root-traefik-1`, `postgresql`, `root-n8n-1`, and
  `webhook-buffer` containers (verified).
- You have SSH access as `root@srv844822.hstgr.cloud`.
- Traefik provisions Let's Encrypt certs via the `mytlschallenge` resolver
  for any container labeled with a `Host(...)` rule on the
  `root_default` Docker network.

The deployment adds the following new containers on `root_default`:

| container                | role                              | host                                            |
|--------------------------|-----------------------------------|-------------------------------------------------|
| `revenue-engine-db-1`    | Supabase Postgres                 | internal only (no host port)                    |
| `revenue-engine-auth-1`  | GoTrue (auth)                     | internal                                        |
| `revenue-engine-rest-1`  | PostgREST                         | internal                                        |
| `revenue-engine-storage-1` | Supabase Storage                | internal                                        |
| `revenue-engine-meta-1`  | postgres-meta                     | internal                                        |
| `revenue-engine-kong-1`  | API gateway                       | `https://revenue-api.srv844822.hstgr.cloud`     |
| `revenue-engine-studio-1`| Supabase Studio (admin UI)        | `https://revenue-studio.srv844822.hstgr.cloud` |
| `revenue-engine-web`     | Vite frontend (built + served)    | `https://revenue.srv844822.hstgr.cloud`         |

**Nothing else on the VPS gets restarted** — the existing `postgresql`,
`n8n`, `webhook-buffer`, and `traefik` containers stay running as-is.
We run our own `supabase/postgres` because the existing one is a vanilla
Postgres that does not have the Supabase roles, extensions, or schemas.

---

## Step 1 — Point DNS at the VPS

In your DNS provider, add three `A` records pointing at the VPS public IP:

```
revenue.srv844822.hstgr.cloud           A    <VPS_IP>
revenue-api.srv844822.hstgr.cloud       A    <VPS_IP>
revenue-studio.srv844822.hstgr.cloud    A    <VPS_IP>
```

If you already use a wildcard `*.srv844822.hstgr.cloud` record, skip this
step — those subdomains will already resolve.

Confirm before continuing:

```bash
dig revenue.srv844822.hstgr.cloud +short
dig revenue-api.srv844822.hstgr.cloud +short
dig revenue-studio.srv844822.hstgr.cloud +short
```

Each should return the VPS IP.

---

## Step 2 — On your laptop: generate prod JWT keys

Never reuse dev keys in production.

```bash
cd ~/Desktop/NEw/metrics-loom
JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n=' | cut -c1-64)" \
  scripts/generate-keys.sh
```

Output looks like:

```
JWT_SECRET=...
ANON_KEY=...
SERVICE_ROLE_KEY=...
```

Copy all three. You'll paste them into the VPS `.env` in Step 4.

---

## Step 3 — On the VPS: clone the repo

```bash
ssh root@srv844822.hstgr.cloud
cd /root
git clone https://github.com/Sepnexus/Revenue-Engine.git revenue-engine
cd revenue-engine
```

---

## Step 4 — On the VPS: create `.env`

```bash
cp infra/.env.prod.example infra/.env
# install htpasswd for the Studio basic-auth hash
apt-get install -y apache2-utils
# generate a bcrypt hash for Studio admin:
htpasswd -nbB admin 'pick-a-strong-password'
# copy the entire output line and paste below as STUDIO_BASIC_AUTH
# IMPORTANT: in docker-compose, $ must be escaped as $$. Sed does it for you:
htpasswd -nbB admin 'pick-a-strong-password' | sed -e 's/\$/\$\$/g'

nano infra/.env
```

Fill in:

| key                          | value                                                    |
|------------------------------|----------------------------------------------------------|
| `POSTGRES_PASSWORD`          | `openssl rand -base64 32` output (strong, no spaces)     |
| `JWT_SECRET`                 | from Step 2                                              |
| `ANON_KEY`                   | from Step 2                                              |
| `SERVICE_ROLE_KEY`           | from Step 2                                              |
| `STUDIO_BASIC_AUTH`          | the `$$`-escaped htpasswd output                         |
| `SMTP_*`                     | your SMTP provider creds (Resend / SES / Postmark / etc.)|

Save (Ctrl+O, Enter, Ctrl+X).

---

## Step 5 — On the VPS: boot the stack

```bash
cd /root/revenue-engine
docker compose \
  --env-file infra/.env \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.prod.yml \
  up -d --build
```

First build takes 3–5 minutes (mostly the Vite build + image pulls).

Watch the services come up:

```bash
docker compose --env-file infra/.env \
  -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  ps
```

All services should be `Up` and `healthy` (auth/rest/storage may restart
once during DB init — that's normal).

---

## Step 6 — Wait for Traefik certs (~30s) and verify

```bash
curl -I https://revenue-api.srv844822.hstgr.cloud/auth/v1/health
curl -I https://revenue.srv844822.hstgr.cloud/
```

Both should return `HTTP/2 200`. If you get a cert error, wait another
minute and retry — Let's Encrypt provisioning sometimes takes a moment.

---

## Step 7 — Migrate users + data from Lovable

On your laptop, regenerate the two export files from Lovable (see
[`LOVABLE_EXPORT.md`](./LOVABLE_EXPORT.md) — TODO) **as close as possible
to the cutover time** so you don't lose recent writes.

Copy the files up:

```bash
scp ~/Downloads/full-database-export.sql \
    root@srv844822.hstgr.cloud:/root/revenue-engine/backups/
scp ~/Downloads/auth-users-export.sql \
    root@srv844822.hstgr.cloud:/root/revenue-engine/backups/
```

On the VPS:

```bash
cd /root/revenue-engine
DB_CONTAINER=revenue-engine-db-1 ./scripts/restore-from-lovable.sh
```

You should see the same row counts you saw locally:

```
auth.users          17
organizations       10
profiles            15
kpi_periods         29
...
rls_policies        48
```

---

## Step 8 — Smoke test as a real user

Open `https://revenue.srv844822.hstgr.cloud` in your browser. Log in as
`akshay@sepnexus.com` with your current Lovable password. You should land
on the dashboard with your real organizations and KPI history.

If something fails, check:

```bash
docker logs --tail 100 revenue-engine-auth-1
docker logs --tail 100 revenue-engine-rest-1
docker logs --tail 100 revenue-engine-kong-1
docker logs --tail 100 revenue-engine-web
```

---

## Updating later

When you push code changes to GitHub:

```bash
ssh root@srv844822.hstgr.cloud
cd /root/revenue-engine
git pull
docker compose --env-file infra/.env \
  -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  up -d --build web   # rebuild only the frontend if that's all that changed
```

Schema changes (new files in `supabase/migrations/`) require either:
- A fresh DB volume + restore (acceptable pre-cutover), or
- Applying the migration manually via `psql` in the running `db` container.

---

## Rollback

Take down the stack without touching anything else:

```bash
cd /root/revenue-engine
docker compose --env-file infra/.env \
  -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  down
```

This stops the 8 new containers and removes the network endpoints.
Postgres data persists in the `revenue-engine_db-data` volume.
To also wipe the data: add `-v` to the down command.

---

## DNS cutover (the real switch)

Until you're happy with the VPS instance, your real users keep using
Lovable. The cutover is just a DNS / frontend change:

1. **Day before:** Do a final dry-run of Steps 7–8 against fresh exports
   to confirm the import still works.
2. **Maintenance window (10–30 min):** Ask users to pause. Pull fresh
   exports from Lovable. Run `restore-from-lovable.sh` again on the VPS.
3. **Flip:** Wherever your real users currently log in (the Lovable URL),
   either:
   - Update their bookmark / shortcut to `https://revenue.srv844822.hstgr.cloud`, or
   - Point your real domain (e.g. `app.sepnexus.com`) at the VPS and add
     it to `PROD_WEB_HOST` + redeploy `web`.
4. **Verify:** Have 2–3 real users log in and confirm their data shows.
5. **Leave Lovable up for 1–2 weeks** as a safety net before tearing it down.
