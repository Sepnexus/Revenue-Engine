# Multi-stage build: compile the Vite app, then serve the static files
# with nginx. Vite bakes env vars at build time, so VITE_SUPABASE_URL /
# VITE_SUPABASE_PUBLISHABLE_KEY are passed as build args.
#
# Build:
#   docker build \
#     --build-arg VITE_SUPABASE_URL=https://revenue-api.srv844822.hstgr.cloud \
#     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=eyJ... \
#     -t revenue-engine-web:latest apps/web

FROM node:20-alpine AS builder
WORKDIR /app

# Install deps first for cache efficiency
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Build
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
