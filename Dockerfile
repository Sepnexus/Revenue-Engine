# syntax=docker/dockerfile:1.7
# All-in-one image: Postgres 15 + GoTrue (Supabase Auth) + PostgREST + nginx
# + the Vite frontend served as static files. One container, two HTTP ports
# (3000 = frontend, 54321 = Supabase API gateway). Same pattern as
# webhook-buffer / ibuykc-dashboard, which work reliably on the VPS Traefik.

# ─── Stage 1: build the Vite frontend → static files ──────────
FROM node:20-bookworm-slim AS web-builder
WORKDIR /build

# Build-time VITE_* are baked into the JS bundle, so they must be set here.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY apps/web/ ./
RUN npm run build
# Build artifacts now at /build/dist (static HTML/CSS/JS).

# ─── Stage 2: runtime — everything in one image ───────────────
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/lib/postgresql/15/bin:$PATH

# Postgres 15 + nginx + utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg lsb-release procps xz-utils tini \
      postgresql-15 postgresql-contrib-15 postgresql-client-15 nginx libpq5 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/nginx /var/lib/nginx /var/lib/postgresql/data \
             /var/run/postgresql /var/www/html \
 && chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql

# GoTrue (Auth) + PostgREST: pull binaries from the official images
COPY --from=supabase/gotrue:v2.158.1     /usr/local/bin/auth              /usr/local/bin/auth
COPY --from=supabase/gotrue:v2.158.1     /usr/local/etc/auth/migrations   /usr/local/etc/auth/migrations
COPY --from=postgrest/postgrest:v12.2.3  /bin/postgrest                   /usr/local/bin/postgrest
RUN chmod +x /usr/local/bin/auth /usr/local/bin/postgrest

# Drop the built Vite static files into nginx's web root
COPY --from=web-builder /build/dist /var/www/html

# Init + runtime scripts
COPY supabase/migrations           /docker-init/migrations
COPY docker/schema-init.sql        /docker-init/schema-init.sql
COPY docker/post-migrations.sql    /docker-init/post-migrations.sql
COPY docker/init-db.sh             /docker-init/init-db.sh
COPY docker/start.sh               /start.sh
COPY docker/nginx.conf             /etc/nginx/nginx.conf
RUN chmod +x /docker-init/init-db.sh /start.sh

# Postgres data persists across container restarts
VOLUME ["/var/lib/postgresql/data"]

EXPOSE 3000 54321

# tini = small init that reaps zombies (we have 4 long-running children)
ENTRYPOINT ["/usr/bin/tini", "--", "/start.sh"]
