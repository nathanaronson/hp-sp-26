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
import logging
import time
from contextlib import contextmanager
from typing import Any

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
from app.services.agents import (
    ANALYZE_REPORT_PATH,
    ANALYZE_SYSTEM,
    EXPOSE_REPORT_PATH,
    EXPOSE_SYSTEM,
    render_analyze_user,
    render_expose_user,
)
from app.services.agents.heuristics import try_synthesize_plan
from app.services.sandbox import Sandbox, SandboxError
from app.services import sandbox_pool

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

    dlog.info(
        "loaded: name=%r github_url=%s upload_id=%s model=%s",
        name, github_url, upload_id, model,
    )
    await _append_log(
        deployment_id,
        f"Starting deployment: source={github_url or upload_id} model={model}",
    )

    if not github_url:
        await _update_deployment(
            deployment_id,
            status=DEPLOYMENT_STATUS_FAILED,
            error=(
                "Upload-based deployments not yet supported. "
                "Provide `github_url` instead."
            ),
        )
        await _append_log(
            deployment_id,
            "ERROR: upload-based deployments not yet supported. Use github_url.",
        )
        dlog.warning("upload-based deployments not supported (upload_id=%s); failing fast",
                     upload_id)
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

        await _append_log(deployment_id, f"Cloning {github_url}...")
        with _step(dlog, "clone repo"):
            await asyncio.to_thread(_clone_into_sync, sb, github_url)
        await _append_log(deployment_id, "Repo cloned.")

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
                source_description=f"GitHub repo: {github_url}",
                name=name,
                user_env_keys=[],
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

        install_cmds = plan.get("install_commands") or []
        build_cmds = plan.get("build_commands") or []
        start_cmds = plan.get("start_commands") or []
        dlog.info(
            "plan summary: runtime=%s pm=%s install=%d cmds build=%d cmds services=%d confidence=%s",
            plan.get("runtime"),
            plan.get("package_manager"),
            len(install_cmds),
            len(build_cmds),
            len(start_cmds),
            plan.get("confidence"),
        )
        await _append_log(
            deployment_id,
            f"Plan: runtime={plan.get('runtime')} pm={plan.get('package_manager')} "
            f"services={len(start_cmds)} confidence={plan.get('confidence')}",
        )
        for cmd in install_cmds:
            await _append_log(deployment_id, f"  install: {cmd}")
        for cmd in build_cmds:
            await _append_log(deployment_id, f"  build:   {cmd}")
        for svc in start_cmds:
            await _append_log(
                deployment_id,
                f"  start [{svc.get('label', '?')}]: {svc.get('command')} (port_hint={svc.get('port_hint')})",
            )
        await _update_deployment(
            deployment_id,
            runtime=plan.get("runtime"),
            package_manager=plan.get("package_manager"),
            install_commands=install_cmds,
            build_commands=build_cmds,
            start_command=start_cmds[0].get("command") if start_cmds else None,
            start_commands=start_cmds,
            run_commands=install_cmds + build_cmds,
            env_required=plan.get("env_required") or [],
        )

        # ------------------------------------------------------------------
        # 2b. Pre-fetch tunnel URLs for multi-service projects
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
        # 3. Agent #2 — expose
        # ------------------------------------------------------------------
        await _update_deployment(deployment_id, status=DEPLOYMENT_STATUS_BUILDING)
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
            env_keys_set=[],
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


__all__ = ["run_deployment", "teardown_deployment", "DEFAULT_MODEL"]
