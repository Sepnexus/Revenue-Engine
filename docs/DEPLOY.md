# Deploy Revenue Engine to the Hostinger VPS

**One container.** Bundles Postgres + Supabase Auth (GoTrue) + REST (PostgREST)
+ nginx + the Vite frontend inside a single image. Same proven pattern as
`webhook-buffer` and `ibuykc-dashboard` on this VPS.

**Assumes** the VPS already runs `root-traefik-1` and exposes the
`root_default` Docker network. Nothing else gets touched.

---

## Step 0 — Tear down the previous (multi-container) attempt

```bash
ssh root@srv844822.hstgr.cloud
cd /root/revenue-engine 2>/dev/null && \
  docker compose --env-file infra/.env \
    -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
    down -v 2>/dev/null || true
docker rm -f revenue-engine-web metrics-loom-db-1 metrics-loom-auth-1 \
              metrics-loom-rest-1 metrics-loom-storage-1 metrics-loom-meta-1 \
              metrics-loom-kong-1 metrics-loom-studio-1 metrics-loom-inbucket-1 \
              metrics-loom-web-1 2>/dev/null || true
docker volume rm metrics-loom_db-data metrics-loom_storage-data 2>/dev/null || true
rm -rf /root/revenue-engine
```

---

## Step 1 — On the VPS: clone fresh & generate secrets

```bash
cd /root
git clone https://github.com/Sepnexus/Revenue-Engine.git revenue-engine
cd revenue-engine

# Generate Postgres passwords + JWT keys (prints to screen)
bash docker/gen-keys.sh
```

Output looks like:

```
POSTGRES_PASSWORD=...
AUTHENTICATOR_PASSWORD=...
AUTH_ADMIN_PASSWORD=...
JWT_SECRET=...
ANON_KEY=...
SERVICE_ROLE_KEY=...
```

Copy that whole block — you'll paste it into `.env` next.

---

## Step 2 — On the VPS: create `.env`

```bash
cp .env.example .env
nano .env
```

In nano:
1. The first 4 lines (`PUBLIC_HOST`, `PUBLIC_API_HOST`, `SITE_URL`,
   `VITE_SUPABASE_URL`) — leave as-is for `revenue.sepnexus.com` /
   `revenue-api.sepnexus.com`. Change if you want different subdomains.
2. **Replace the six `CHANGE_ME_*` lines** with the values from Step 1.

Save: `Ctrl+O`, Enter, `Ctrl+X`.

---

## Step 3 — DNS

Make sure these point at the VPS IP (`93.127.194.153`):

```
revenue.sepnexus.com       A    93.127.194.153
revenue-api.sepnexus.com   A    93.127.194.153
```

```bash
dig +short revenue.sepnexus.com
dig +short revenue-api.sepnexus.com
```

---

## Step 4 — On the VPS: build & start

```bash
docker compose up -d --build
```

First build takes **3–6 minutes** (downloads Node, Postgres, GoTrue,
PostgREST + builds the Vite frontend). When it returns:

```bash
docker logs -f revenue-engine
```

Expected output, in order:
```
[init-db] fresh cluster — initializing
[init-db] setting postgres superuser password and creating app database
[init-db] bootstrapping roles + auth schema
[init-db] running GoTrue migrations (creates auth.users etc.)
[init-db] applying user migrations
[init-db]   ↳ 20260225180143_...sql
[init-db]   ...
[init-db] init complete
[start] booting Postgres
[start] booting GoTrue (auth)
[start] booting PostgREST
[start] booting nginx (frontend on :3000, API gateway on :54321)
[start] all 4 services up
```

Press `Ctrl+C` to stop tailing. The container keeps running.

---

## Step 5 — Verify TLS + routing

Wait ~30s for Traefik to provision Let's Encrypt certs, then:

```bash
curl -I https://revenue.sepnexus.com/
curl -I https://revenue-api.sepnexus.com/auth/v1/health
```

Both should return `HTTP/2 200` (no `-k` needed).

---

## Step 6 — Restore your real Lovable data

From your **laptop**:

```bash
scp ~/Downloads/full-database-export.sql \
    ~/Downloads/auth-users-export.sql \
    root@srv844822.hstgr.cloud:/root/revenue-engine/backups/
```

Then on the **VPS**:

```bash
cd /root/revenue-engine
./scripts/restore-from-lovable.sh
```

You should see row counts like:
```
auth.users      17
organizations   10
profiles        15
kpi_periods     29
...
rls_policies    48
```

---

## Step 7 — Log in

Open **https://revenue.sepnexus.com** in your browser. Log in as
`akshay@sepnexus.com` with your real Lovable password. You should land
on the dashboard with all your real orgs and KPI history.

---

## Updating later

When you push code changes to GitHub:

```bash
ssh root@srv844822.hstgr.cloud
cd /root/revenue-engine
git pull
docker compose up -d --build
```

Postgres data survives (it's on the named volume `revenue_engine_pgdata`).
Only the app code is rebuilt.

---

## Troubleshooting

**`docker compose up` says `network root_default not found`**
The Traefik network is named differently on a fresh VPS. Run
`docker network ls` and edit `docker-compose.yml` at the bottom.

**Traefik 404 on the URL**
Check the container joined the right network:
```bash
docker inspect revenue-engine --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```
Should show `root_default`.

**SSL cert never appears**
Confirm DNS resolves to the VPS and wait 60 seconds for first issuance:
```bash
dig revenue.sepnexus.com +short
dig revenue-api.sepnexus.com +short
```

**Container restarts in a loop**
```bash
docker logs --tail 200 revenue-engine
```
Look for `[init-db]` errors (DB issue) or `[start]` errors (config).

**Wipe and start fresh** (destroys the DB)
```bash
docker compose down -v
docker compose up -d --build
# then re-run scripts/restore-from-lovable.sh
```

**Rollback / remove entirely**
```bash
cd /root/revenue-engine
docker compose down       # keeps data volume
docker compose down -v    # also wipes the database
```
Your other containers (`postgresql`, `n8n`, `traefik`, `webhook-buffer`,
`ibuykc-dashboard`) are untouched.
