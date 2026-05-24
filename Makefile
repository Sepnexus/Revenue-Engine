SHELL := /usr/bin/env bash

.DEFAULT_GOAL := help

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

# ---------- local (laptop) ----------

build:  ## Build the image locally
	docker compose build

up:  ## Start the container (uses .env)
	docker compose up -d

down:  ## Stop and remove container (KEEP volume)
	docker compose down

nuke:  ## Stop + remove container AND volume (destroys local DB!)
	docker compose down -v

logs:  ## Tail container logs
	docker logs -f revenue-engine

psql:  ## Open psql inside the container
	@source .env 2>/dev/null; \
	docker exec -it -e PGPASSWORD="$$POSTGRES_PASSWORD" revenue-engine \
	  psql -h 127.0.0.1 -U postgres -d "$${POSTGRES_DB:-revenue_engine}"

# ---------- secrets ----------

keys:  ## Print fresh JWT/Postgres secrets (paste into .env)
	@bash docker/gen-keys.sh

# ---------- data ----------

restore:  ## Restore from backups/{full-database,auth-users}-export.sql
	./scripts/restore-from-lovable.sh
