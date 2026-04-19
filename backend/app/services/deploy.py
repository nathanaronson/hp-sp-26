"""Deployment orchestrator.

Drives a Deployment row through its full lifecycle:

    pending
      → provisioning  (Modal sandbox created, OpenClaw gateway up, repo cloned)
      → analyzing     (Agent #1 runs)
      → building      (install + build commands run by Agent #2)
      → exposing      (Agent #2 starts server, finds port, verifies HTTP)
      → running       (Modal tunnel opened, public_url set)

      → failed        (anything raised; error column populated)

The actual chat round-trips happen on the OpenClaw gateway *inside* the
sandbox — see `app.services.sandbox.Sandbox.chat`. We persist an `AgentRun`
row per agent with the full chat response, the parsed structured report,
and the model that was used.

Concurrency model
-----------------
The Modal SDK is sync. To stay friendly to FastAPI's event loop, the public
entrypoint `run_deployment` is async and offloads each blocking step to a
worker thread via `asyncio.to_thread`. DB writes happen between steps using
`AsyncSession`s (one short-lived session per persistence checkpoint).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import shlex
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.deployment import (
    AGENT_KIND_ANALYZE,
    AGENT_KIND_EXPOSE,
    AGENT_STATUS_FAILED,
    AGENT_STATUS_RUNNING,
    AGENT_STATUS_SUCCEEDED,
    DEPLOYMENT_STATUS_ANALYZING,
    DEPLOYMENT_STATUS_BUILDING,
    DEPLOYMENT_STATUS_EXPOSING,
    DEPLOYMENT_STATUS_FAILED,
    DEPLOYMENT_STATUS_PROVISIONING,
    DEPLOYMENT_STATUS_RUNNING,
    AgentRun,
    Deployment,
)
from app.services import sandbox_pool
from app.services.agents import (
    ANALYZE_REPORT_PATH,
    ANALYZE_SYSTEM,
    EXPOSE_REPORT_PATH,
    EXPOSE_SYSTEM,
    render_analyze_user,
    render_expose_user,
)
from app.services.agents.heuristics import try_synthesize_plan
from app.services.sandbox import (
    CLI_TERMINAL_PORT,
    REPO_DIR,
    Sandbox,
    SandboxError,
)
from app.services.uploads import get_upload_record

log = logging.getLogger(__name__)

# Default LLM the OpenClaw agent uses. Haiku 4.5 is ~2x faster prefill than
# Sonnet on our workload (lots of small tool turns) and good enough for the
# install-plan / port-discovery tasks. Override per-deployment via the
# Deployment.model column or the `model` field in DeploymentCreate.
DEFAULT_MODEL = "anthropic/claude-haiku-4-5"


class _DeployLogger(logging.LoggerAdapter):
    """LoggerAdapter that injects a short deployment id prefix into messages."""

    def process(self, msg, kwargs):
        did = self.extra.get("deployment_id", "?")[:8]
        return f"[dep {did}] {msg}", kwargs


def _logger_for(deployment_id: str) -> _DeployLogger:
    return _DeployLogger(log, {"deployment_id": deployment_id})


@contextmanager
def _step(dlog: _DeployLogger, name: str, **fields: Any):
    """Time a logical step. Logs start, end (with duration), or exception."""
    extra = " " + " ".join(f"{k}={_short(v)}" for k, v in fields.items()) if fields else ""
    dlog.info(">> %s%s", name, extra)
    t0 = time.perf_counter()
    try:
        yield
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        dlog.error("xx %s failed in %dms: %s", name, elapsed_ms, _short(e))
        raise
    else:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        dlog.info("<< %s ok in %dms", name, elapsed_ms)


def _short(value: Any, limit: int = 200) -> str:
    """Stringify + truncate a value for safe logging."""
    s = str(value).replace("\n", " ")
    if len(s) > limit:
        return s[:limit] + f"...({len(s) - limit} more)"
    return s


# ---------------------------------------------------------------------------
# .env file helpers
# ---------------------------------------------------------------------------
#
# Users can attach a `KEY -> value` mapping when creating a deployment. We
# materialize those into one or more `.env` files inside the sandbox before
# Agent #2 runs so install/build/start commands pick them up automatically.
#
# Why files instead of `export FOO=...` in each command?
#   * Many frameworks (Next.js, Vite, CRA, dotenv, pydantic-settings, ...)
#     expect a `.env` file at runtime / build-time.
#   * Survives across PIDs, shells, and nohup background processes started
#     by Agent #2 — exporting per-command would not.
#
# Where do we drop them?
#   * REPO_DIR/.env (always).
#   * For multi-service projects, also REPO_DIR/<svc>/.env for any service
#     whose start command starts with `cd <subdir> && ...`. This way a
#     monorepo backend at `backend/` and frontend at `frontend/` both see
#     the vars regardless of cwd.

_CD_PREFIX_RE = re.compile(r"^\s*cd\s+([^\s&;|]+)\s*(?:&&|;|$)")


def _format_dotenv(env_vars: dict[str, str]) -> str:
    """Render a `KEY=value` .env file. Values are double-quoted with shell-
    style escaping so anything (spaces, `#`, `=`) survives a round-trip."""
    out = []
    for key in sorted(env_vars):
        raw = env_vars[key] or ""
        # Most .env loaders treat literal newlines as record separators; encode
        # them as `\n` inside a double-quoted value (dotenv-style expansion).
        normalized = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
        escaped = normalized.replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'{key}="{escaped}"')
    return "\n".join(out) + "\n"


def _service_subdirs(start_commands: list[dict[str, Any]] | None) -> list[str]:
    """Pull `cd <subdir>` prefixes out of each service's start command so we
    can drop a copy of the .env right next to where the service runs."""
    subdirs: list[str] = []
    for svc in start_commands or []:
        cmd = (svc.get("command") or "").strip()
        m = _CD_PREFIX_RE.match(cmd)
        if not m:
            continue
        sub = m.group(1).strip("'\"")
        # Reject absolute paths and `..` traversal — keep the file inside the repo.
        if sub.startswith("/") or sub.startswith(".."):
            continue
        if sub in (".", "./"):
            continue
        if sub not in subdirs:
            subdirs.append(sub)
    return subdirs


def _write_env_file_sync(sb: Sandbox, path: str, content: str) -> None:
    """Write a file to the sandbox via base64 to dodge shell escaping issues."""
    encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    parent = path.rsplit("/", 1)[0] or "/"
    sb.check_exec(
        f"mkdir -p {shlex.quote(parent)} && "
        f"printf %s {shlex.quote(encoded)} | base64 -d > {shlex.quote(path)} && "
        f"chmod 600 {shlex.quote(path)}",
        timeout_s=15,
    )


def _materialize_env_files_sync(
    sb: Sandbox,
    env_vars: dict[str, str],
    start_commands: list[dict[str, Any]] | None,
) -> list[str]:
    """Write `.env` to REPO_DIR plus each detected service subdirectory.
    Returns the list of paths actually written."""
    if not env_vars:
        return []
    content = _format_dotenv(env_vars)
    written: list[str] = []
    targets = [REPO_DIR] + [f"{REPO_DIR}/{sub}" for sub in _service_subdirs(start_commands)]
    for target in targets:
        path = f"{target.rstrip('/')}/.env"
        _write_env_file_sync(sb, path, content)
        written.append(path)
    return written


def _frontend_terminal_url(deployment_id: str) -> str:
    """Authenticated in-app terminal route. Useful for the deployment owner
    when they want to pass extra args; not the shareable public link."""
    base = get_settings().frontend_url.rstrip("/")
    return f"{base}/deployment/{deployment_id}/terminal"


# ---------------------------------------------------------------------------
# Tiny DB helpers — each opens its own short-lived session.
# ---------------------------------------------------------------------------

async def _update_deployment(deployment_id: str, **fields: Any) -> None:
    async with SessionLocal() as db:
        dep = await db.get(Deployment, deployment_id)
        if dep is None:
            log.warning("update_deployment: %s not found", deployment_id)
            return
        for k, v in fields.items():
            setattr(dep, k, v)
        await db.commit()


async def _append_log(deployment_id: str, line: str) -> None:
    """Append one human-readable line to `Deployment.logs`.

    Used to power the frontend's "Build Logs" panel. Each line is timestamped
    so the user can see roughly when each step happened.
    """
    from datetime import UTC, datetime
    stamp = datetime.now(UTC).strftime("%H:%M:%S")
    formatted = f"[{stamp}] {line}\n"
    async with SessionLocal() as db:
        dep = await db.get(Deployment, deployment_id)
        if dep is None:
            return
        dep.logs = (dep.logs or "") + formatted
        await db.commit()


async def _create_agent_run(deployment_id: str, kind: str, model: str) -> str:
    async with SessionLocal() as db:
        run = AgentRun(
            deployment_id=deployment_id,
            kind=kind,
            status=AGENT_STATUS_RUNNING,
            model=model,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run.id


async def _finalize_agent_run(
    run_id: str,
    *,
    status: str,
    system_prompt: str | None = None,
    transcript: list[dict[str, Any]] | None = None,
    result: dict[str, Any] | None = None,
    terminal_tool: str | None = None,
    tool_call_count: int = 0,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    error: str | None = None,
) -> None:
    async with SessionLocal() as db:
        run = await db.get(AgentRun, run_id)
        if run is None:
            return
        run.status = status
        if system_prompt is not None:
            run.system_prompt = system_prompt
        if transcript is not None:
            run.transcript = transcript
        if result is not None:
            run.result = result
        if terminal_tool is not None:
            run.terminal_tool = terminal_tool
        run.tool_call_count = tool_call_count
        if input_tokens is not None:
            run.input_tokens = input_tokens
        if output_tokens is not None:
            run.output_tokens = output_tokens
        if error is not None:
            run.error = error
        await db.commit()


# ---------------------------------------------------------------------------
# Sync helpers (run inside `to_thread`)
# ---------------------------------------------------------------------------

def _clone_into_sync(sb: Sandbox, github_url: str) -> None:
    """Clone the repo into a sandbox that already has the gateway running."""
    try:
        sb.clone_repo_async(github_url)
        sb.wait_for_repo()
    except Exception:
        sb.terminate()
        raise


def _extract_upload_into_repo_sync(sb: Sandbox, archive_path: Path) -> None:
    """Seed REPO_DIR from an uploaded tarball."""
    sb.extract_upload_archive(archive_path)


def _repo_has(sb: Sandbox, relative_path: str) -> bool:
    res = sb.exec(
        f"test -f {shlex.quote(relative_path)}",
        cwd=REPO_DIR,
        timeout_s=10,
        stdout_limit=1_000,
        stderr_limit=1_000,
    )
    return res.ok()


def _normalize_build_command(sb: Sandbox, command: str) -> str:
    normalized = command.strip()
    if not normalized:
        return normalized

    if _repo_has(sb, "mvnw"):
        normalized = re.sub(r"(^|&&\s*)mvn(?=\s|$)", r"\1./mvnw", normalized)

    if _repo_has(sb, "gradlew"):
        normalized = re.sub(r"(^|&&\s*)gradle(?=\s|$)", r"\1./gradlew", normalized)

    return normalized


def _normalize_plan_commands(sb: Sandbox, plan: dict[str, Any]) -> dict[str, Any]:
    plan = dict(plan)
    plan["install_commands"] = [
        _normalize_build_command(sb, cmd)
        for cmd in plan.get("install_commands") or []
    ]
    plan["build_commands"] = [
        _normalize_build_command(sb, cmd)
        for cmd in plan.get("build_commands") or []
    ]
    return plan


def _run_install_sync(sb: Sandbox, plan: dict[str, Any]) -> None:
    """Execute install + build commands directly in the sandbox.

    Used for `kind=cli` deployments where we skip Agent #2 entirely.
    Raises `SandboxError` (via `check_exec`) on the first non-zero exit so
    the caller can surface a structured failure.
    """
    for cmd in plan.get("install_commands") or []:
        sb.check_exec(cmd, cwd=REPO_DIR, timeout_s=600,
                      stdout_limit=200_000, stderr_limit=200_000)
    for cmd in plan.get("build_commands") or []:
        sb.check_exec(cmd, cwd=REPO_DIR, timeout_s=900,
                      stdout_limit=200_000, stderr_limit=200_000)


def _run_agent_sync(
    sb: Sandbox,
    *,
    system: str,
    user: str,
    report_path: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Send one chat turn, parse the JSON report file the agent wrote.

    Returns (raw_chat_response, report_dict, usage_dict).
    """
    response = sb.chat(system=system, user=user, timeout_s=600)
    usage = response.get("usage", {}) or {}
    try:
        report = sb.read_json(report_path)
    except SandboxError as e:
        raise SandboxError(
            f"agent did not write report at {report_path}. "
            f"Last assistant text:\n"
            f"{_extract_text(response)[:1000]}\n"
            f"(read error: {e})"
        ) from e
    return response, report, usage


def _extract_text(response: dict[str, Any]) -> str:
    try:
        return response["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""


def _build_transcript(
    *,
    system: str,
    user: str,
    response: dict[str, Any],
) -> list[dict[str, Any]]:
    """Mirror the request + response into a list[{role, content}]."""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
        {"role": "assistant", "content": _extract_text(response)},
    ]


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

async def run_deployment(deployment_id: str) -> None:
    """Run a deployment end-to-end. Always returns; never raises.

    Errors are persisted to the Deployment row's `error` column with status
    set to `failed`. The caller (a FastAPI BackgroundTask) doesn't need to
    handle exceptions.
    """
    dlog = _logger_for(deployment_id)
    overall_t0 = time.perf_counter()
    dlog.info("starting deployment")

    # Load source + name once.
    async with SessionLocal() as db:
        dep = await db.get(Deployment, deployment_id)
        if dep is None:
            dlog.error("deployment row not found, abandoning")
            return
        github_url = dep.github_url
        upload_id = dep.upload_id
        name = dep.name or "(unnamed)"
        model = dep.model or DEFAULT_MODEL
        env_vars: dict[str, str] = dict(dep.env_vars or {})

    env_keys = sorted(env_vars.keys())
    dlog.info(
        "loaded: name=%r github_url=%s upload_id=%s model=%s env_keys=%s",
        name, github_url, upload_id, model, env_keys,
    )
    await _append_log(
        deployment_id,
        f"Starting deployment: source={github_url or upload_id} model={model}",
    )

    if not github_url and not upload_id:
        await _update_deployment(
            deployment_id,
            status=DEPLOYMENT_STATUS_FAILED,
            error="Deployment source missing (expected github_url or upload_id).",
        )
        await _append_log(
            deployment_id,
            "ERROR: deployment source missing.",
        )
        dlog.warning(
            "deployment source missing (github_url=%s upload_id=%s)",
            github_url,
            upload_id,
        )
        return

    sb: Sandbox | None = None
    try:
        # ------------------------------------------------------------------
        # 1. Acquire warm sandbox + clone repo
        # ------------------------------------------------------------------
        # The pool gives us a sandbox with the gateway already running and
        # the model already configured (or sets it on the fly). This typically
        # saves the 18s gateway cold-boot. On a pool miss we provision fresh.
        await _update_deployment(
            deployment_id, status=DEPLOYMENT_STATUS_PROVISIONING
        )
        await _append_log(deployment_id, "Provisioning sandbox...")
        with _step(dlog, "acquire warm sandbox", model=model):
            sb = await sandbox_pool.acquire(model)
        await _update_deployment(deployment_id, sandbox_id=sb.object_id)
        dlog.info("sandbox acquired: id=%s", sb.object_id)
        await _append_log(deployment_id, f"Sandbox ready: {sb.object_id}")

        source_description = ""
        if github_url:
            await _append_log(deployment_id, f"Cloning {github_url}...")
            with _step(dlog, "clone repo"):
                await asyncio.to_thread(_clone_into_sync, sb, github_url)
            await _append_log(deployment_id, "Repo cloned.")
            source_description = f"GitHub repo: {github_url}"
        else:
            record = get_upload_record(upload_id or "")
            if record is None:
                raise RuntimeError(f"Upload {upload_id} is missing from upload storage")
            await _append_log(
                deployment_id,
                f"Preparing uploaded source {record.upload_id} ({record.original_filename})...",
            )
            with _step(dlog, "extract uploaded archive", upload_id=record.upload_id):
                await asyncio.to_thread(_extract_upload_into_repo_sync, sb, record.archive_path)
            await _append_log(deployment_id, "Uploaded project extracted.")
            source_description = f"Uploaded archive: {record.upload_id}"

        # ------------------------------------------------------------------
        # 2. Agent #1 — analyze (with heuristic fast-path)
        # ------------------------------------------------------------------
        await _update_deployment(deployment_id, status=DEPLOYMENT_STATUS_ANALYZING)
        await _append_log(deployment_id, "Analyzing project...")
        analyze_run_id = await _create_agent_run(
            deployment_id, AGENT_KIND_ANALYZE, model
        )
        dlog.info("analyze: agent_run=%s", analyze_run_id)

        plan: dict | None = None

        # Try the cheap path first: synthesize a plan from file contents alone.
        # Saves the 60-90s LLM round-trip when the project is unambiguous.
        with _step(dlog, "analyze heuristic"):
            heuristic_plan = await asyncio.to_thread(try_synthesize_plan, sb)

        if heuristic_plan is not None:
            plan = heuristic_plan
            dlog.info(
                "analyze: heuristic synthesized plan, skipping LLM (runtime=%s, services=%d)",
                plan.get("runtime"), len(plan.get("start_commands") or []),
            )
            await _append_log(
                deployment_id,
                "Plan synthesized from file inspection (no LLM needed).",
            )
            await _finalize_agent_run(
                analyze_run_id,
                status=AGENT_STATUS_SUCCEEDED,
                system_prompt="(heuristic, no LLM)",
                transcript=[{
                    "role": "system",
                    "content": "Plan synthesized from repo file inspection (no LLM).",
                }],
                result=plan,
                terminal_tool="report_install_plan",
            )
        else:
            await _append_log(
                deployment_id,
                f"Heuristic uncertain; running Agent #1 (analyze) with {model}...",
            )
            analyze_user = render_analyze_user(
                source_description=source_description,
                name=name,
                user_env_keys=env_keys,
            )
            try:
                with _step(dlog, "analyze chat"):
                    response, plan, usage = await asyncio.to_thread(
                        _run_agent_sync,
                        sb,
                        system=ANALYZE_SYSTEM,
                        user=analyze_user,
                        report_path=ANALYZE_REPORT_PATH,
                    )
            except Exception as e:
                await _finalize_agent_run(
                    analyze_run_id,
                    status=AGENT_STATUS_FAILED,
                    system_prompt=ANALYZE_SYSTEM,
                    error=str(e),
                )
                await _append_log(deployment_id, f"Agent #1 failed: {_short(e, 200)}")
                raise

            terminal = "report_failure" if plan.get("error") else "report_install_plan"
            dlog.info(
                "analyze done: terminal=%s tokens(in=%s out=%s) plan=%s",
                terminal,
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
                _short(plan, 300),
            )
            await _finalize_agent_run(
                analyze_run_id,
                status=AGENT_STATUS_SUCCEEDED,
                system_prompt=ANALYZE_SYSTEM,
                transcript=_build_transcript(
                    system=ANALYZE_SYSTEM, user=analyze_user, response=response
                ),
                result=plan,
                terminal_tool=terminal,
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
            )

        if plan.get("error"):
            err = (
                f"analyze failed: [{plan.get('reason_code')}] "
                f"{plan.get('message')}"
            )
            await _update_deployment(
                deployment_id,
                status=DEPLOYMENT_STATUS_FAILED,
                error=err,
            )
            await _append_log(deployment_id, f"ERROR: {err}")
            dlog.warning("agent #1 reported failure: %s", _short(err, 300))
            return

        plan = await asyncio.to_thread(_normalize_plan_commands, sb, plan)
        install_cmds = plan.get("install_commands") or []
        build_cmds = plan.get("build_commands") or []
        kind = plan.get("kind") or "web"
        start_cmds = plan.get("start_commands") or []
        # CLI deployments keep a single `start_command` (the binary to spawn
        # under a PTY). Web deployments use the multi-service `start_commands`
        # list; we still mirror the first one into `start_command` for any
        # legacy consumers reading the old field.
        cli_start_cmd = plan.get("start_command") or ""
        entrypoint = shlex.split(cli_start_cmd) if cli_start_cmd else None

        dlog.info(
            "plan summary: kind=%s runtime=%s pm=%s install=%d cmds build=%d cmds services=%d confidence=%s",
            kind,
            plan.get("runtime"),
            plan.get("package_manager"),
            len(install_cmds),
            len(build_cmds),
            len(start_cmds),
            plan.get("confidence"),
        )
        await _append_log(
            deployment_id,
            f"Plan: kind={kind} runtime={plan.get('runtime')} "
            f"pm={plan.get('package_manager')} "
            f"services={len(start_cmds)} confidence={plan.get('confidence')}",
        )
        for cmd in install_cmds:
            await _append_log(deployment_id, f"  install: {cmd}")
        for cmd in build_cmds:
            await _append_log(deployment_id, f"  build:   {cmd}")
        if kind == "cli":
            await _append_log(deployment_id, f"  start:   {cli_start_cmd}")
        else:
            for svc in start_cmds:
                await _append_log(
                    deployment_id,
                    f"  start [{svc.get('label', '?')}]: {svc.get('command')} (port_hint={svc.get('port_hint')})",
                )

        if kind == "cli":
            persisted_start_cmd: str | None = cli_start_cmd or None
        else:
            persisted_start_cmd = start_cmds[0].get("command") if start_cmds else None

        await _update_deployment(
            deployment_id,
            kind=kind,
            entrypoint=entrypoint,
            runtime=plan.get("runtime"),
            package_manager=plan.get("package_manager"),
            install_commands=install_cmds,
            build_commands=build_cmds,
            start_command=persisted_start_cmd,
            start_commands=start_cmds,
            run_commands=install_cmds + build_cmds,
            env_required=plan.get("env_required") or [],
        )

        # ------------------------------------------------------------------
        # 3a. CLI kind — skip Agent #2. Run install/build, then expose the
        # CLI as a public web terminal via ttyd inside the sandbox + a
        # Modal tunnel. The deployment's public_url becomes a shareable
        # HTTPS link to a clean xterm.js page wired straight to the binary.
        # ------------------------------------------------------------------
        if kind == "cli":
            await _update_deployment(deployment_id, status=DEPLOYMENT_STATUS_BUILDING)
            if env_vars:
                with _step(dlog, "write .env files (cli)", count=len(env_vars)):
                    written = await asyncio.to_thread(
                        _materialize_env_files_sync, sb, env_vars, start_cmds,
                    )
                await _append_log(
                    deployment_id,
                    f"Wrote {len(env_vars)} env var(s) to {', '.join(written)}",
                )
            await _append_log(
                deployment_id,
                "CLI deployment: running install/build commands...",
            )
            try:
                with _step(dlog, "cli install+build"):
                    await asyncio.to_thread(_run_install_sync, sb, plan)
            except SandboxError as e:
                err = f"install/build failed: {_short(e, 300)}"
                await _update_deployment(
                    deployment_id,
                    status=DEPLOYMENT_STATUS_FAILED,
                    error=err,
                )
                await _append_log(deployment_id, f"ERROR: {err}")
                dlog.warning("cli install/build failed: %s", _short(e, 300))
                return

            if not entrypoint:
                err = (
                    "CLI deployment has no start_command/entrypoint, can't "
                    "front a web terminal."
                )
                await _update_deployment(
                    deployment_id,
                    status=DEPLOYMENT_STATUS_FAILED,
                    error=err,
                )
                await _append_log(deployment_id, f"ERROR: {err}")
                return

            await _update_deployment(deployment_id, status=DEPLOYMENT_STATUS_EXPOSING)
            await _append_log(
                deployment_id,
                f"Starting public web terminal (ttyd) on :{CLI_TERMINAL_PORT}...",
            )
            try:
                with _step(dlog, "start ttyd", port=CLI_TERMINAL_PORT):
                    await asyncio.to_thread(
                        sb.start_ttyd,
                        entrypoint,
                        port=CLI_TERMINAL_PORT,
                        cwd=REPO_DIR,
                        title=f"{name} · dploy",
                    )
            except SandboxError as e:
                err = f"ttyd start failed: {_short(e, 300)}"
                await _update_deployment(
                    deployment_id,
                    status=DEPLOYMENT_STATUS_FAILED,
                    error=err,
                )
                await _append_log(deployment_id, f"ERROR: {err}")
                return

            with _step(dlog, "open tunnel", port=CLI_TERMINAL_PORT):
                public_url = await asyncio.to_thread(sb.tunnel, CLI_TERMINAL_PORT)
            if not public_url:
                # Fall back to the in-app terminal URL so the owner at
                # least has a way in. Not shareable, but better than
                # nothing.
                public_url = _frontend_terminal_url(deployment_id)
                await _append_log(
                    deployment_id,
                    f"WARNING: no Modal tunnel for :{CLI_TERMINAL_PORT}; "
                    f"falling back to authenticated in-app terminal: {public_url}",
                )

            await _update_deployment(
                deployment_id,
                status=DEPLOYMENT_STATUS_RUNNING,
                port=CLI_TERMINAL_PORT,
                bound_address=f"0.0.0.0:{CLI_TERMINAL_PORT}",
                health_path="/",
                http_status=200,
                exposed_ports=[CLI_TERMINAL_PORT],
                public_url=public_url,
            )
            elapsed = int((time.perf_counter() - overall_t0) * 1000)
            dlog.info(
                "CLI DEPLOYMENT READY in %dms: entrypoint=%s public_url=%s",
                elapsed, entrypoint, public_url,
            )
            await _append_log(
                deployment_id,
                f"CLI READY ({elapsed/1000:.1f}s total) — public terminal: {public_url}",
            )
            await _append_log(
                deployment_id,
                f"  entrypoint: {shlex.join(entrypoint) if entrypoint else '(no entrypoint)'}",
            )
            return

        # ------------------------------------------------------------------
        # 3b. Pre-fetch tunnel URLs for multi-service web projects
        # ------------------------------------------------------------------
        # Modal tunnels are available as soon as the sandbox is created
        # (ports were declared via encrypted_ports). For monorepos with
        # frontend + backend, we fetch the tunnel URLs now so Agent #2 can
        # rewrite localhost references in the frontend before building.
        tunnel_urls_by_label: dict[str, str] | None = None
        if len(start_cmds) > 1:
            service_ports = [
                s.get("port_hint") for s in start_cmds
                if s.get("port_hint")
            ]
            if service_ports:
                with _step(dlog, "pre-fetch tunnel URLs", ports=service_ports):
                    port_to_url = await asyncio.to_thread(
                        sb.tunnel_all, service_ports
                    )
                if port_to_url:
                    tunnel_urls_by_label = {}
                    for svc in start_cmds:
                        label = svc.get("label", "unknown")
                        hint = svc.get("port_hint")
                        if hint and hint in port_to_url:
                            tunnel_urls_by_label[label] = port_to_url[hint]
                    dlog.info(
                        "pre-fetched tunnel URLs: %s",
                        tunnel_urls_by_label,
                    )
                    for label, url in tunnel_urls_by_label.items():
                        await _append_log(
                            deployment_id,
                            f"Tunnel pre-provisioned: {label} -> {url}",
                        )

        # ------------------------------------------------------------------
        # 4. Agent #2 — expose  (web kind only)
        # ------------------------------------------------------------------
        await _update_deployment(deployment_id, status=DEPLOYMENT_STATUS_BUILDING)
        if env_vars:
            with _step(dlog, "write .env files", count=len(env_vars)):
                written = await asyncio.to_thread(
                    _materialize_env_files_sync, sb, env_vars, start_cmds,
                )
            await _append_log(
                deployment_id,
                f"Wrote {len(env_vars)} env var(s) ({', '.join(env_keys)}) "
                f"to {', '.join(written)}",
            )
        await _append_log(
            deployment_id,
            "Building & starting server (Agent #2)...",
        )
        expose_run_id = await _create_agent_run(
            deployment_id, AGENT_KIND_EXPOSE, model
        )
        dlog.info("expose: agent_run=%s", expose_run_id)
        expose_user = render_expose_user(
            plan=plan,
            env_keys_set=env_keys,
            tunnel_urls=tunnel_urls_by_label,
        )
        try:
            with _step(dlog, "expose chat"):
                response, port_report, usage = await asyncio.to_thread(
                    _run_agent_sync,
                    sb,
                    system=EXPOSE_SYSTEM,
                    user=expose_user,
                    report_path=EXPOSE_REPORT_PATH,
                )
        except Exception as e:
            await _finalize_agent_run(
                expose_run_id,
                status=AGENT_STATUS_FAILED,
                system_prompt=EXPOSE_SYSTEM,
                error=str(e),
            )
            await _append_log(deployment_id, f"Agent #2 failed: {_short(e, 200)}")
            raise

        terminal = "report_failure" if port_report.get("error") else "report_port"
        dlog.info(
            "expose done: terminal=%s tokens(in=%s out=%s) report=%s",
            terminal,
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
            _short(port_report, 300),
        )
        await _finalize_agent_run(
            expose_run_id,
            status=AGENT_STATUS_SUCCEEDED,
            system_prompt=EXPOSE_SYSTEM,
            transcript=_build_transcript(
                system=EXPOSE_SYSTEM, user=expose_user, response=response
            ),
            result=port_report,
            terminal_tool=terminal,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )

        if port_report.get("error"):
            err = (
                f"expose failed: [{port_report.get('reason_code')}] "
                f"{port_report.get('message')}"
            )
            await _update_deployment(
                deployment_id,
                status=DEPLOYMENT_STATUS_FAILED,
                error=err,
            )
            await _append_log(deployment_id, f"ERROR: {err}")
            evidence = port_report.get("evidence")
            if evidence:
                await _append_log(deployment_id, f"  evidence: {_short(evidence, 600)}")
            dlog.warning("agent #2 reported failure: %s", _short(err, 300))
            return

        # ------------------------------------------------------------------
        # 4. Open public tunnels
        # ------------------------------------------------------------------
        await _update_deployment(deployment_id, status=DEPLOYMENT_STATUS_EXPOSING)
        port = int(port_report.get("primary_port") or port_report.get("port") or 0)
        services = port_report.get("services") or []

        for svc in services:
            await _append_log(
                deployment_id,
                f"Service [{svc.get('label', '?')}]: port={svc.get('port')} "
                f"bound={svc.get('bound_address')} status={svc.get('http_status')} "
                f"health={svc.get('health_path')}",
            )
        if not services:
            await _append_log(
                deployment_id,
                f"Server up: port={port} bound={port_report.get('bound_address')} "
                f"status={port_report.get('http_status')} health={port_report.get('health_path')}",
            )

        exposed_ports = [s.get("port") for s in services if s.get("port")] or ([port] if port else [])

        # Open tunnels for ALL service ports (not just primary).
        all_tunnel_ports = list(set(exposed_ports))
        with _step(dlog, "open tunnels", ports=all_tunnel_ports):
            port_to_url = await asyncio.to_thread(
                sb.tunnel_all, all_tunnel_ports
            )
        public_url = port_to_url.get(port)
        if port and not public_url:
            # Fallback: try opening just the primary port directly.
            with _step(dlog, "open primary tunnel fallback", port=port):
                public_url = await asyncio.to_thread(sb.tunnel, port)

        if port and not public_url:
            dlog.warning(
                "no public tunnel for port %d (not in TUNNELABLE_PORTS or modal "
                "tunnels() returned nothing); app reachable internally only",
                port,
            )
            await _append_log(
                deployment_id,
                f"WARNING: no public tunnel available for port {port} "
                "(not in pre-declared port list); app reachable inside sandbox only.",
            )

        # Build label → URL mapping and identify backend URL.
        final_tunnel_urls: dict[str, str] = {}
        backend_url: str | None = None
        for svc in services:
            svc_port = svc.get("port")
            svc_label = svc.get("label", "unknown")
            if svc_port and svc_port in port_to_url:
                url = port_to_url[svc_port]
                final_tunnel_urls[svc_label] = url
                await _append_log(
                    deployment_id,
                    f"Tunnel [{svc_label}]: port {svc_port} -> {url}",
                )
                if svc_label in ("backend", "api", "server") and svc_port != port:
                    backend_url = url

        primary_svc = next((s for s in services if s.get("port") == port), {})
        await _update_deployment(
            deployment_id,
            status=DEPLOYMENT_STATUS_RUNNING,
            port=port,
            bound_address=primary_svc.get("bound_address") or port_report.get("bound_address"),
            health_path=primary_svc.get("health_path") or port_report.get("health_path"),
            http_status=primary_svc.get("http_status") or port_report.get("http_status"),
            exposed_ports=exposed_ports,
            public_url=public_url,
            backend_url=backend_url,
            tunnel_urls=final_tunnel_urls or None,
        )
        elapsed = int((time.perf_counter() - overall_t0) * 1000)
        dlog.info(
            "DEPLOYMENT RUNNING in %dms: port=%d bound=%s status=%s url=%s",
            elapsed,
            port,
            port_report.get("bound_address"),
            port_report.get("http_status"),
            public_url or "(internal only)",
        )
        await _append_log(
            deployment_id,
            f"DEPLOYMENT RUNNING ({elapsed/1000:.1f}s total)" +
            (f" — public URL: {public_url}" if public_url else " — internal only"),
        )

    except Exception as e:
        elapsed = int((time.perf_counter() - overall_t0) * 1000)
        dlog.exception("deployment failed after %dms: %s", elapsed, _short(e))
        await _update_deployment(
            deployment_id,
            status=DEPLOYMENT_STATUS_FAILED,
            error=str(e)[:4000],
        )
        await _append_log(
            deployment_id,
            f"FAILED after {elapsed/1000:.1f}s: {_short(e, 400)}",
        )
        if sb is not None:
            with _step(dlog, "terminate sandbox after failure"):
                await asyncio.to_thread(sb.terminate)
    # On success we deliberately do NOT terminate — the sandbox keeps running
    # so the deployed app stays reachable. Teardown happens via DELETE.


# ---------------------------------------------------------------------------
# Teardown — used by the DELETE route.
# ---------------------------------------------------------------------------

async def teardown_sandbox(
    sandbox_id: str,
    *,
    deployment_id: str = "?",
) -> None:
    dlog = _logger_for(deployment_id)
    dlog.info("teardown: terminating sandbox %s", sandbox_id)

    def _terminate() -> None:
        try:
            sb = Sandbox.from_id(sandbox_id)
            sb.terminate()
        except Exception:
            log.exception("teardown failed for sandbox %s", sandbox_id)

    t0 = time.perf_counter()
    await asyncio.to_thread(_terminate)
    dlog.info("teardown: sandbox %s terminated in %dms",
              sandbox_id, int((time.perf_counter() - t0) * 1000))


async def teardown_deployment(deployment_id: str) -> None:
    dlog = _logger_for(deployment_id)
    async with SessionLocal() as db:
        dep = await db.get(Deployment, deployment_id)
        if dep is None:
            dlog.warning("teardown: deployment row not found")
            return
        if not dep.sandbox_id:
            dlog.info("teardown: no sandbox to terminate (never provisioned)")
            return
        sandbox_id = dep.sandbox_id

    await teardown_sandbox(sandbox_id, deployment_id=deployment_id)


__all__ = ["run_deployment", "teardown_deployment", "teardown_sandbox", "DEFAULT_MODEL"]
