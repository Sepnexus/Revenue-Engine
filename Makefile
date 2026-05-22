SHELL := /usr/bin/env bash
COMPOSE := docker compose --env-file infra/.env -f infra/docker-compose.yml
COMPOSE_PROD := $(COMPOSE) -f infra/docker-compose.prod.yml

.DEFAULT_GOAL := help

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

# ---------- bootstrap ----------

bootstrap:  ## Generate infra/.env + apps/web/.env from .example + fresh keys
	@test -f infra/.env || cp infra/.env.example infra/.env
	@test -f apps/web/.env || cp apps/web/.env.example apps/web/.env
	@echo "Generating JWT keys..."
	@scripts/generate-keys.sh > /tmp/ml-keys.env
	@./scripts/_apply-keys.sh /tmp/ml-keys.env || ( \
	   echo "Paste these into infra/.env:"; cat /tmp/ml-keys.env )
	@echo "Done. Review infra/.env and apps/web/.env."

# ---------- local dev ----------

dev:  ## Start the full Supabase stack locally (with mail catcher)
	$(COMPOSE) --profile dev up -d
	@echo "API:    http://localhost:8000"
	@echo "Studio: http://localhost:3000"
	@echo "Mail:   http://localhost:9000"

dev-web:  ## Run the Vite frontend (separately, so logs are visible)
	cd apps/web && (test -d node_modules || bun install) && bun run dev

stop:  ## Stop the stack (keep volumes)
	$(COMPOSE) stop

down:  ## Stop and remove containers (KEEP volumes)
	$(COMPOSE) down

nuke:  ## Stop + remove containers AND volumes (destroys local DB!)
	$(COMPOSE) down -v

logs:  ## Tail all stack logs
	$(COMPOSE) logs -f --tail=100

psql:  ## Open a psql shell into the local DB
	$(COMPOSE) exec db psql -U postgres -d postgres

# ---------- migration ----------

migrate-from-lovable:  ## Dump Lovable Supabase and restore into TARGET (set SOURCE_DB_URL, TARGET_DB_URL)
	./scripts/migrate-from-lovable.sh

migrate-from-lovable-dry:  ## Same as above but skip the restore
	DRY_RUN=1 ./scripts/migrate-from-lovable.sh

# ---------- production ----------

prod-up:  ## Bring up the prod stack on the VPS
	$(COMPOSE_PROD) up -d

prod-down:
	$(COMPOSE_PROD) down

prod-logs:
	$(COMPOSE_PROD) logs -f --tail=100

build-web:  ## Build the frontend for production
	cd apps/web && bun install && bun run build
