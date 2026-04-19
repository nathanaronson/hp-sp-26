# dploy

> Building software is faster than deploying it. `dploy` closes that gap.

Point `dploy` at a GitHub repo (or a local project), and it provisions an ephemeral sandbox, figures out how to run it, and hands you a live URL — without you touching a config file.

## What It Solves

Deployment usually requires someone to inspect the repo, pick a runtime, identify install and start commands, find the right port, and wire everything together manually. AI tools have cut the time it takes to *build* software, but that deployment overhead remains.

`dploy` absorbs that step. It uses deterministic heuristics for common stacks (Node, Python, Go) and falls back to an agent-driven analysis pass for anything messier. Multi-service repos, CLI tools, and non-standard layouts are handled, not rejected.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React, Vite, TanStack Query, Tailwind, xterm.js |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| Sandbox runtime | Modal |
| Agent runtime | OpenClaw |
| Models | Claude Haiku 4.5 (configurable) |
| Auth | GitHub OAuth |
| CLI | TypeScript, Ink |

## Getting Started

### Prerequisites

- [uv](https://github.com/astral-sh/uv) — Python package manager
- [pnpm](https://pnpm.io) — Node package manager

### Install dependencies

```bash
make install
```

### Run the full stack (backend + frontend)

```bash
make dev
```

This starts the FastAPI backend on `http://localhost:8000` and the Vite frontend dev server concurrently. `Ctrl-C` stops both.

### Run individually

```bash
make backend    # FastAPI only
make frontend   # Vite only
```

### Run the CLI

```bash
make cli ARGS="deploy https://github.com/org/repo"
```

Pass any `dploy` arguments via `ARGS`. See `dploy --help` for the full command reference.

## CLI Commands

```
dploy deploy [path|github-url]   Deploy a local project or GitHub repo
dploy list                       List all deployments
dploy status <id>                Check deployment status
dploy stop <id>                  Tear down a deployment
dploy open <id>                  Open the deployment URL in your browser
dploy login                      Authenticate via GitHub OAuth
dploy logout
dploy whoami                     Print the current user
```

## Other Make Targets

```bash
make test       # Run backend tests (pytest)
make lint       # Lint backend (ruff) + frontend (eslint)
make fmt        # Format backend with ruff
make api        # Regenerate typed API client from OpenAPI schema
make build      # Production build of the frontend
make clean      # Remove caches, dist artifacts, and local DB
```

## How It Works

Each deployment follows this pipeline:

1. Provision or acquire a warm sandbox (pool kept ready to avoid cold-start latency)
2. Clone the repo / receive the uploaded tarball
3. Run a deterministic heuristic analysis — common stacks skip the LLM entirely
4. If needed, Agent #1 inspects the codebase and produces an install/build/start plan
5. CLI repos are exposed as a browser terminal via `ttyd`
6. Web apps go through Agent #2: build, start, discover ports, verify HTTP, report live services
7. Tunnels are opened for detected ports and URLs are stored

## Authors

- Nathan Aronson
- Kaitlyn Kwan
- Ryan Tanenholz
- Samuel Lao
