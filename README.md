# Revenue Engine

Self-hosted single-container deploy of the Revenue Engine app
(Vite + React + shadcn frontend + Supabase backend), originally built
on Lovable.

The whole stack — Postgres, Supabase Auth (GoTrue), Supabase REST
(PostgREST), nginx, and the compiled frontend — runs inside **one
Docker container**. Same pattern as `webhook-buffer` and
`ibuykc-dashboard` on the VPS.

## Layout

```
.
├── Dockerfile                  All-in-one image
├── docker-compose.yml          Traefik labels + named volume
├── .env.example                Required env vars (copy to .env)
│
├── docker/
│   ├── start.sh                Entrypoint — boots Postgres + Auth + REST + nginx
│   ├── init-db.sh              First-boot DB init (idempotent)
│   ├── schema-init.sql         Roles + auth schema bootstrap
│   ├── post-migrations.sql     Grants for PostgREST after migrations apply
│   ├── nginx.conf              :3000 = static frontend, :54321 = Supabase gateway
│   └── gen-keys.sh             Generates POSTGRES + JWT secrets
│
├── apps/web/                   Vite frontend (compiled into the image)
├── supabase/migrations/        Lovable's DB migrations
│
├── scripts/
│   └── restore-from-lovable.sh Wipes + reloads from a Lovable Cloud export
│
├── backups/                    Drop Lovable exports here (gitignored)
└── docs/DEPLOY.md              Step-by-step VPS deploy
```

## Quick start

See [`docs/DEPLOY.md`](./docs/DEPLOY.md) for the full step-by-step. TL;DR:

```bash
ssh root@<your-vps>
git clone <this-repo> revenue-engine && cd revenue-engine
bash docker/gen-keys.sh                  # outputs secrets, paste into .env
cp .env.example .env && nano .env        # fill in secrets + your domain
docker compose up -d --build             # build + start (3–6 min first time)
./scripts/restore-from-lovable.sh        # after dropping Lovable exports into backups/
```

Open `https://<your-domain>` and log in with your real Lovable password.

## Why one container?

Trade-off:
- **Pro:** dead simple to deploy alongside other Traefik-routed apps. Just
  one set of labels, one container, one volume. No multi-container
  network/label discovery quirks.
- **Con:** Postgres, Auth, REST, and the frontend can't be scaled
  independently. For a low-traffic internal dashboard like Revenue
  Engine, that's the right trade-off.
