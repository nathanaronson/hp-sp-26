# dploy

Building software is faster than deploying it.

`dploy` is built around a simple idea: if a repo is runnable, getting it live should be fast. The goal is to deploy *most things* quickly, with as little setup and manual inference as possible.

## Inspiration

AI tools reduced the time it takes to build software. Deployment still often requires someone to inspect the repo, choose the runtime, figure out install and start commands, identify ports, and sort out service layout by hand.

`dploy` is meant to absorb that step. Point it at a repo, let it determine how the project should run, and get back something usable: a live app URL, a set of service URLs, or a browser terminal for a CLI.

## What It Does

Today the working path is centered on GitHub repositories. A user signs in with GitHub, pastes a repo URL, and `dploy` provisions an ephemeral sandbox, analyzes the codebase, installs dependencies, starts the project, verifies it, and exposes it publicly when possible.

The product is built around two ideas: speed for common cases and coverage for messier ones.

- Common projects should deploy fast without needing an LLM round-trip.
- Less standard projects should still have a path because an agent can inspect and adapt.
- Web apps and CLI tools are both first-class.
- Multi-service repos should not be treated as edge cases.

In practice, the system can:

- Detect straightforward Node, Python, and Go repos with a deterministic heuristic fast-path.
- Fall back to an agent-driven analyze step when the repo is ambiguous or uncommon.
- Run multi-service projects with separate `start_commands` for things like frontend and backend.
- Pre-provision tunnel URLs for multiple services and feed those URLs back into the build/start flow.
- Return a primary public URL plus service-specific URLs when more than one port matters.
- Treat CLI projects differently from web apps and expose them as shareable browser terminals.
- Persist logs, agent runs, plan details, and failure evidence so deployments are inspectable.

One important caveat: the repo already includes upload and local-project plumbing, but the deployment backend currently fails fast unless a `github_url` is provided. Local project deploys are clearly part of the intended direction, but GitHub repos are the real end-to-end path in the current code.

## Why It Is Fast

The repo is optimized for reducing latency:

- **Heuristics before agents.** Clear repos can skip the LLM analyze pass entirely.
- **Warm sandboxes.** The backend keeps a sandbox pool ready so the next deploy avoids gateway cold-start time.
- **Agent work inside the sandbox.** Analyze and expose steps run where the code and processes already are.

## Current Product Surface

- **FastAPI backend** orchestrates deployments, sandbox lifecycle, auth, logs, and teardown.
- **React frontend** provides GitHub sign-in, deployment creation, dashboard views, live status, build logs, per-service URLs, and terminal access.
- **CLI app** supports login and deployment-oriented workflows and points toward local-project deployment as a future first-class path.
- **CLI deployments** are first-class in the backend model: the system can classify a repo as `kind="cli"` and front it with `ttyd`.
- **Interactive terminal access** exists in two forms: a public browser terminal for CLI deployments and an authenticated in-app terminal route for deployment owners.
- **Multi-service deployment support** includes labeled services, multiple exposed ports, a primary URL, optional backend URL, and a tunnel URL map.
- **Operational diagnostics** expose sandbox-pool state and OpenClaw configuration details for tuning and debugging.

## How It Works

At a high level, each deployment follows this shape:

1. Provision or acquire a warm sandbox.
2. Clone the repo.
3. Try a deterministic heuristic analyze pass.
4. If needed, run Agent #1 to produce an install/build/start plan.
5. If the project is a CLI, run install/build and expose it through a browser terminal.
6. If the project is a web app, run Agent #2 to build, start, discover ports, verify HTTP, and report the services that are actually up.
7. Open tunnels for the detected ports and store the resulting URLs.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React, Vite, TanStack Query, Tailwind, xterm.js |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| Sandbox runtime | Modal |
| Agent runtime | OpenClaw |
| Models | Configurable per deployment, defaulting to Claude Haiku 4.5 |
| Auth | GitHub OAuth |
| CLI | TypeScript + Ink |

## Emphasis

- deployment speed is a product feature
- broad repo coverage matters more than framework-specific polish
- deterministic fast-paths matter more than extra prompt complexity
- CLIs, multi-service apps, and odd repo layouts should be handled, not rejected by default

## What's Next

- finish the local upload path so local-project deploys are truly end-to-end
- add more heuristic coverage so more repos skip the LLM entirely
- expand runtime coverage for more "non-standard but still common" projects
- keep improving multi-service support, especially for frontend/backend repos
- make the system even better at fast failure with useful evidence when a repo genuinely cannot be run
