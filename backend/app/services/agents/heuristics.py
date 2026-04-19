"""Pure-Python plan synthesis for the easy 80% of projects.

When the project layout is unambiguous (e.g. `package.json` with `scripts.start`,
`pyproject.toml` with a recognizable web framework), we can skip Agent #1
entirely — saving the 60-90s LLM round-trip — and synthesize the install
plan from file contents alone.

The orchestrator calls `try_synthesize_plan(sb)` after the repo is cloned.
If it returns a plan dict, we record it as an `AgentRun(kind=analyze,
terminal_tool="report_install_plan")` with model="heuristic" and proceed
straight to Agent #2. If it returns None, we fall back to the LLM.

Conservatism principle
----------------------
False positives are expensive (Agent #2 fails on a wrong plan, deployment
fails, user is frustrated). False negatives are cheap (we just run the LLM).
So this only fires on layouts where we're highly confident. If anything looks
weird (Dockerfile present, multiple lockfiles, custom Procfile, etc.) we bail
and let the LLM decide.
"""

from __future__ import annotations

import json
import logging
import shlex
from typing import Any

from app.services.sandbox import REPO_DIR, Sandbox, SandboxError

log = logging.getLogger(__name__)


def try_synthesize_plan(sb: Sandbox) -> dict[str, Any] | None:
    """Return a plan dict if the project is unambiguous, else None."""
    try:
        # Cheap one-shot listing of the repo root (no recursion).
        listing = _list_root(sb)
    except SandboxError:
        log.warning("heuristic: could not list repo root, falling back to LLM")
        return None

    names = set(listing)

    # If there's a Dockerfile we punt to the LLM — too many ways to wire it.
    if "Dockerfile" in names or "docker-compose.yml" in names:
        log.info("heuristic: Dockerfile detected, deferring to LLM")
        return None

    # Try Node.
    if "package.json" in names:
        plan = _try_node(sb, names)
        if plan is not None:
            log.info("heuristic: synthesized node plan: %s",
                     plan.get("start_commands"))
            return plan

    # Try Python.
    if "pyproject.toml" in names or "requirements.txt" in names:
        plan = _try_python(sb, names)
        if plan is not None:
            log.info("heuristic: synthesized python plan: %s",
                     plan.get("start_commands"))
            return plan

    # Try Go.
    if "go.mod" in names and ("main.go" in names or "cmd" in names):
        plan = _try_go(sb, names)
        if plan is not None:
            log.info("heuristic: synthesized go plan: %s",
                     plan.get("start_commands"))
            return plan

    log.info("heuristic: no confident match, deferring to LLM")
    return None


# ---------------------------------------------------------------------------
# Per-runtime detection
# ---------------------------------------------------------------------------

def _try_node(sb: Sandbox, names: set[str]) -> dict[str, Any] | None:
    pkg = _read_json(sb, f"{REPO_DIR}/package.json")
    if not pkg:
        return None
    scripts = pkg.get("scripts") or {}
    if not isinstance(scripts, dict):
        return None

    pm = _detect_node_pm(names)

    # Pick the start command. Prefer `start`, then `dev`, then framework guess.
    start_script = None
    if "start" in scripts:
        start_script = "start"
    elif "dev" in scripts:
        start_script = "dev"

    if start_script is None:
        # Try a framework dependency check.
        deps = (pkg.get("dependencies") or {}) | (pkg.get("devDependencies") or {})
        if "next" in deps:
            start_command = "PORT=3000 HOSTNAME=0.0.0.0 npx next start"
            port_hint = 3000
            build_commands = ["npx next build"]
        elif "vite" in deps:
            start_command = "npx vite preview --host 0.0.0.0 --port 5173"
            port_hint = 5173
            build_commands = ["npx vite build"]
        else:
            return None
    else:
        # Use the script. Inject HOST/PORT so it binds publicly.
        port_hint, host_env = _node_port_for_script(scripts.get(start_script, ""), pkg)
        start_command = f"{host_env} {pm} {start_script}".strip()
        build_commands = []
        # CRA / next typically need a build for `start` script:
        if start_script == "start":
            deps = (pkg.get("dependencies") or {}) | (pkg.get("devDependencies") or {})
            if "next" in deps and "build" in scripts:
                build_commands = [f"{pm} build"]

    install_cmd = _node_install_cmd(pm, names)

    return {
        "runtime": "node",
        "package_manager": pm,
        "install_commands": [install_cmd],
        "build_commands": build_commands,
        "start_commands": [
            {"label": "app", "command": start_command, "port_hint": port_hint},
        ],
        "env_required": _scan_env_example(sb, names),
        "notes": (
            f"Heuristic: package.json with scripts.{start_script or 'inferred'}; "
            f"package manager={pm}."
        ),
        "confidence": "high",
    }


def _try_python(sb: Sandbox, names: set[str]) -> dict[str, Any] | None:
    # Look for clear web-framework markers in pyproject / requirements.
    deps_text = ""
    if "pyproject.toml" in names:
        deps_text += sb.read_text(f"{REPO_DIR}/pyproject.toml", max_bytes=20_000) or ""
    if "requirements.txt" in names:
        deps_text += "\n" + (sb.read_text(f"{REPO_DIR}/requirements.txt", max_bytes=20_000) or "")
    deps_lower = deps_text.lower()

    pm = "uv" if "uv.lock" in names else (
        "poetry" if "poetry.lock" in names else "pip"
    )

    # FastAPI: look for an obvious entrypoint.
    if "fastapi" in deps_lower:
        entry = _find_fastapi_entry(sb)
        if entry is None:
            return None
        if pm == "uv":
            install = "uv sync"
            start = f"uv run uvicorn {entry} --host 0.0.0.0 --port 8000"
        else:
            install = ("pip install -r requirements.txt"
                       if "requirements.txt" in names
                       else "pip install -e .")
            start = f"uvicorn {entry} --host 0.0.0.0 --port 8000"
        return {
            "runtime": "python",
            "package_manager": pm,
            "install_commands": [install],
            "build_commands": [],
            "start_commands": [
                {"label": "api", "command": start, "port_hint": 8000},
            ],
            "env_required": _scan_env_example(sb, names),
            "notes": f"Heuristic: FastAPI app at {entry}, package manager={pm}.",
            "confidence": "high",
        }

    if "flask" in deps_lower:
        # Need to know the app module. Bail to LLM unless app.py exists.
        if "app.py" not in names:
            return None
        install = ("uv sync" if pm == "uv"
                   else "pip install -r requirements.txt"
                   if "requirements.txt" in names
                   else "pip install -e .")
        runner = "uv run " if pm == "uv" else ""
        return {
            "runtime": "python",
            "package_manager": pm,
            "install_commands": [install],
            "build_commands": [],
            "start_commands": [
                {"label": "app", "command": f"{runner}flask --app app run --host 0.0.0.0 --port 5000", "port_hint": 5000},
            ],
            "env_required": _scan_env_example(sb, names),
            "notes": "Heuristic: Flask app at app.py.",
            "confidence": "high",
        }

    if "streamlit" in deps_lower:
        entry = "app.py" if "app.py" in names else "streamlit_app.py" if "streamlit_app.py" in names else None
        if entry is None:
            return None
        install = ("uv sync" if pm == "uv"
                   else "pip install -r requirements.txt"
                   if "requirements.txt" in names
                   else "pip install -e .")
        runner = "uv run " if pm == "uv" else ""
        return {
            "runtime": "python",
            "package_manager": pm,
            "install_commands": [install],
            "build_commands": [],
            "start_commands": [
                {
                    "label": "app",
                    "command": (
                        f"{runner}streamlit run {entry} "
                        "--server.address 0.0.0.0 --server.port 8501"
                    ),
                    "port_hint": 8501,
                },
            ],
            "env_required": _scan_env_example(sb, names),
            "notes": f"Heuristic: Streamlit app at {entry}.",
            "confidence": "high",
        }

    return None


def _try_go(sb: Sandbox, _names: set[str]) -> dict[str, Any] | None:
    # We can't know the port without reading the source; bail unless main.go is small.
    main_text = sb.read_text(f"{REPO_DIR}/main.go", max_bytes=10_000) or ""
    port = _grep_port_from_text(main_text)
    if port is None:
        return None
    return {
        "runtime": "go",
        "package_manager": "go",
        "install_commands": ["go mod download"],
        "build_commands": [],
        "start_commands": [
            {"label": "app", "command": "go run .", "port_hint": port},
        ],
        "env_required": [],
        "notes": f"Heuristic: Go module, main.go binds to {port}.",
        "confidence": "medium",
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _list_root(sb: Sandbox) -> list[str]:
    res = sb.exec(
        f"ls -1A {shlex.quote(REPO_DIR)} 2>/dev/null",
        timeout_s=10,
    )
    if not res.ok():
        raise SandboxError(f"could not list {REPO_DIR}")
    return [line.strip() for line in res.stdout.splitlines() if line.strip()]


def _read_json(sb: Sandbox, path: str) -> dict[str, Any] | None:
    try:
        return sb.read_json(path, max_bytes=200_000)
    except SandboxError:
        return None


def _detect_node_pm(names: set[str]) -> str:
    if "pnpm-lock.yaml" in names:
        return "pnpm"
    if "yarn.lock" in names:
        return "yarn"
    if "bun.lockb" in names or "bun.lock" in names:
        return "bun"
    return "npm"


def _node_install_cmd(pm: str, names: set[str]) -> str:
    if pm == "pnpm":
        return "pnpm install --frozen-lockfile" if "pnpm-lock.yaml" in names else "pnpm install"
    if pm == "yarn":
        return "yarn install --frozen-lockfile" if "yarn.lock" in names else "yarn install"
    if pm == "bun":
        return "bun install"
    return "npm ci" if "package-lock.json" in names else "npm install"


def _node_port_for_script(script: str, pkg: dict[str, Any]) -> tuple[int, str]:
    """Return (port_hint, host_env_prefix). Best-effort guess."""
    deps = (pkg.get("dependencies") or {}) | (pkg.get("devDependencies") or {})
    # Explicit port in the script itself.
    port = _grep_port_from_text(script)
    if "next" in deps:
        return port or 3000, "PORT=3000 HOSTNAME=0.0.0.0"
    if "vite" in deps:
        return port or 5173, "HOST=0.0.0.0"
    if "react-scripts" in deps:
        return port or 3000, "HOST=0.0.0.0 PORT=3000"
    if "express" in deps or "fastify" in deps or "@nestjs/core" in deps:
        return port or 3000, "HOST=0.0.0.0 PORT=3000"
    return port or 3000, "HOST=0.0.0.0 PORT=3000"


def _grep_port_from_text(text: str) -> int | None:
    """Look for `:PORT` literal or env var defaults."""
    import re
    # Common patterns: ListenAndServe(":8080"), .listen(3000), --port 8000
    for pat in (
        r":(\d{2,5})\b",
        r"\.listen\(\s*(\d{2,5})",
        r"--port\s+(\d{2,5})",
        r"PORT\s*[:=]\s*(\d{2,5})",
        r"port\s*[:=]\s*(\d{2,5})",
    ):
        m = re.search(pat, text)
        if m:
            try:
                p = int(m.group(1))
                if 1 <= p <= 65535:
                    return p
            except ValueError:
                continue
    return None


def _find_fastapi_entry(sb: Sandbox) -> str | None:
    """Look for an obvious FastAPI entrypoint, return 'module:attr' or None."""
    # Common locations: app/main.py, main.py, src/main.py.
    candidates = [
        ("app/main.py", "app.main:app"),
        ("main.py", "main:app"),
        ("src/main.py", "src.main:app"),
        ("backend/main.py", "backend.main:app"),
    ]
    for rel, dotted in candidates:
        text = sb.read_text(f"{REPO_DIR}/{rel}", max_bytes=8_000) or ""
        if "FastAPI(" in text and "app =" in text.replace(" ", ""):
            return dotted
    return None


def _scan_env_example(sb: Sandbox, names: set[str]) -> list[str]:
    """If a .env.example / .env.sample exists, extract NAMES_LIKE=... keys."""
    for fname in (".env.example", ".env.sample", ".env.template"):
        if fname not in names:
            continue
        text = sb.read_text(f"{REPO_DIR}/{fname}", max_bytes=8_000) or ""
        keys: list[str] = []
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            k, _, _ = line.partition("=")
            k = k.strip()
            if k.isidentifier() or all(c.isalnum() or c == "_" for c in k):
                keys.append(k)
        return keys[:20]
    return []


__all__ = ["try_synthesize_plan"]
