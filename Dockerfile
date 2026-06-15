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

# ─── Stage 1b: compile pg_cron + pg_net from source ───────────
# Neither ships in Debian's apt. The GHL sync needs pg_net (HTTP from inside
# Postgres) and pg_cron (scheduling). We build both against the SAME
# postgresql-server-dev-15 that the runtime's postgresql-15 comes from, so the
# .so files are ABI-compatible. Versions pinned to match local dev
# (pg_cron 1.6.x, pg_net 0.13.0) so the SQL API our migrations use is identical.
FROM debian:bookworm-slim AS ext-builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git ca-certificates \
      postgresql-server-dev-15 libpq-dev libcurl4-openssl-dev \
 && git clone --depth 1 --branch v1.6.4 https://github.com/citusdata/pg_cron.git /tmp/pg_cron \
 && make -C /tmp/pg_cron && make -C /tmp/pg_cron install \
 && git clone --depth 1 --branch v0.13.0 https://github.com/supabase/pg_net.git /tmp/pg_net \
 && make -C /tmp/pg_net && make -C /tmp/pg_net install \
 # Fail the build NOW if either artifact is missing — never ship an image that
 # would crash-loop Postgres on a missing shared_preload_libraries entry.
 && test -f /usr/lib/postgresql/15/lib/pg_cron.so \
 && test -f /usr/lib/postgresql/15/lib/pg_net.so

# ─── Stage 2: runtime — everything in one image ───────────────
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/lib/postgresql/15/bin:$PATH

# Postgres 15 + nginx + utilities. libcurl4 added: pg_net links against it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg lsb-release procps xz-utils tini \
      postgresql-15 postgresql-contrib-15 postgresql-client-15 nginx libpq5 libcurl4 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/nginx /var/lib/nginx /var/lib/postgresql/data \
             /var/run/postgresql /var/www/html \
 && chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql

# Drop the compiled pg_cron + pg_net into the runtime's Postgres tree.
COPY --from=ext-builder /usr/lib/postgresql/15/lib/pg_cron.so          /usr/lib/postgresql/15/lib/
COPY --from=ext-builder /usr/lib/postgresql/15/lib/pg_net.so           /usr/lib/postgresql/15/lib/
COPY --from=ext-builder /usr/share/postgresql/15/extension/pg_cron*    /usr/share/postgresql/15/extension/
COPY --from=ext-builder /usr/share/postgresql/15/extension/pg_net*     /usr/share/postgresql/15/extension/
# Sanity-check the .so files actually resolve their dynamic deps in the runtime.
RUN ldd /usr/lib/postgresql/15/lib/pg_net.so | grep -qi libcurl \
 && test -f /usr/lib/postgresql/15/lib/pg_cron.so

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
