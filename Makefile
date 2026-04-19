.PHONY: help \
        install be-install fe-install \
        dev be-dev fe-dev backend frontend \
        cli \
        be-run \
        test be-test \
        lint be-lint fe-lint \
        fmt be-fmt \
        fix be-fix \
        build fe-build \
        api be-openapi fe-gen-api \
        be-reset-db clean

UV       ?= uv
PNPM     ?= pnpm
BE       := backend
FE       := frontend
CLI_DIR  := cli
BE_HOST  ?= 0.0.0.0
BE_PORT  ?= 8000
ARGS     ?=

help:
	@echo "Common:"
	@echo "  install        Install backend + frontend deps"
	@echo "  dev            Run backend and frontend together (Ctrl-C stops both)"
	@echo "  backend        Run only the backend dev server (alias for be-dev)"
	@echo "  frontend       Run only the frontend dev server (alias for fe-dev)"
	@echo "  cli            Run the CLI locally (pass ARGS=\"...\" to forward args)"
	@echo "  api            Regenerate the typed API client (be-openapi -> fe-gen-api)"
	@echo "  test           Run all tests (currently backend)"
	@echo "  lint           Lint backend + frontend"
	@echo "  build          Production build of the frontend"
	@echo "  clean          Remove caches, dist, local DB"
	@echo ""
	@echo "Backend:"
	@echo "  be-install     uv sync"
	@echo "  be-dev         FastAPI dev server (BE_HOST=$(BE_HOST) BE_PORT=$(BE_PORT))"
	@echo "  be-run         FastAPI production server"
	@echo "  be-test        pytest"
	@echo "  be-lint        ruff check"
	@echo "  be-fmt         ruff format"
	@echo "  be-fix         ruff check --fix"
	@echo "  be-openapi     Dump OpenAPI schema to frontend/openapi.json"
	@echo "  be-reset-db    Delete the local SQLite DB"
	@echo ""
	@echo "Frontend:"
	@echo "  fe-install     pnpm install"
	@echo "  fe-dev         Vite dev server"
	@echo "  fe-lint        eslint"
	@echo "  fe-build       Production build"
	@echo "  fe-gen-api     Regenerate hey-api client from openapi.json"

# ---------- Aggregate ----------

install: be-install fe-install

dev:
	@echo "Starting backend ($(BE_HOST):$(BE_PORT)) and frontend dev servers..."
	@cd $(FE) && $(PNPM) exec concurrently \
		--names "backend,frontend" \
		--prefix-colors "magenta,cyan" \
		--kill-others \
		--handle-input \
		"cd ../$(BE) && $(UV) run fastapi dev app/main.py --host $(BE_HOST) --port $(BE_PORT)" \
		"$(PNPM) dev"

backend: be-dev

frontend: fe-dev

cli:
	cd $(CLI_DIR) && $(PNPM) build && $(PNPM) start -- $(ARGS)

api: be-openapi fe-gen-api

test: be-test

lint: be-lint fe-lint

build: fe-build

clean: be-reset-db
	rm -rf $(BE)/.pytest_cache $(BE)/.ruff_cache $(BE)/.mypy_cache
	find $(BE) -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf $(FE)/dist $(FE)/.vite
	rm -f $(FE)/openapi.json
	rm -rf $(FE)/src/client

# ---------- Backend ----------

be-install:
	cd $(BE) && $(UV) sync

be-dev:
	cd $(BE) && $(UV) run fastapi dev app/main.py --host $(BE_HOST) --port $(BE_PORT)

be-run:
	cd $(BE) && $(UV) run fastapi run app/main.py --host $(BE_HOST) --port $(BE_PORT)

be-test:
	cd $(BE) && $(UV) run pytest

be-lint:
	cd $(BE) && $(UV) run ruff check .

be-fmt:
	cd $(BE) && $(UV) run ruff format .

be-fix:
	cd $(BE) && $(UV) run ruff check . --fix

be-openapi:
	cd $(BE) && $(UV) run python scripts/dump_openapi.py

be-reset-db:
	rm -f $(BE)/app.db $(BE)/app.db-journal

# ---------- Frontend ----------

fe-install:
	cd $(FE) && $(PNPM) install

fe-dev:
	cd $(FE) && $(PNPM) dev

fe-lint:
	cd $(FE) && $(PNPM) lint

fe-build:
	cd $(FE) && $(PNPM) build

fe-gen-api:
	cd $(FE) && $(PNPM) gen:api
