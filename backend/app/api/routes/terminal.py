"""Web terminal — WebSocket bridge between xterm.js and a PTY'd process
inside a deployment's Modal sandbox.

Design (intentionally narrow)
-----------------------------
- We spawn the deployment's entrypoint directly under a PTY. No shell is
  ever exec'd on the user's behalf, so the browser cannot run arbitrary
  commands — it can only interact with whatever stdin the configured
  binary accepts.
- argv = (deployment.entrypoint or shlex-split(deployment.start_command))
         + shlex-split(session_args_from_query)
  Args are passed as argv (not via a shell), so there is no injection
  surface: `--config=$(rm -rf /)` is just a literal string the binary
  sees as an argument.
- Session lifecycle is tied to the WebSocket: process starts on connect,
  dies on disconnect. No persistent shells, no reconnect-to-running.

Auth
----
Same session as the REST API. The browser WebSocket sends the session
cookie automatically (SameSite permitting). For non-browser clients, a
`token` query-string parameter is also accepted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shlex
import time

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from app.db.session import SessionLocal
from app.models.deployment import DEPLOYMENT_STATUS_RUNNING, Deployment
from app.models.user import User
from app.services.auth import get_session_user
from app.services.sandbox import Sandbox
from app.services.terminal_sessions import session_manager

log = logging.getLogger(__name__)

router = APIRouter(prefix="/deployments", tags=["terminal"])

# Hard cap on per-read chunk from the PTY. xterm handles larger writes
# fine; this just bounds how much we buffer in Python between flushes.
_READ_CHUNK = 4096


async def _authenticate(ws: WebSocket) -> User | None:
    """Resolve the connecting user from cookie or `?token=` query param.

    Returns None after closing the socket with 4401 if auth fails.
    """
    from app.core.config import get_settings

    token = ws.cookies.get(get_settings().session_cookie_name)
    if not token:
        token = ws.query_params.get("token")
    if not token:
        await ws.close(code=4401, reason="not authenticated")
        return None
    async with SessionLocal() as db:
        user = await get_session_user(db, token)
    if user is None:
        await ws.close(code=4401, reason="invalid or expired session")
        return None
    return user


async def _load_deployment(deployment_id: str, user_id: str) -> Deployment | None:
    async with SessionLocal() as db:
        dep = await db.get(Deployment, deployment_id)
        if dep is None or dep.user_id != user_id:
            return None
        return dep


def _build_argv(dep: Deployment, session_args: str | None) -> list[str]:
    """Derive the argv for the PTY exec from the deployment + query args.

    `entrypoint` (if set) wins over `start_command`. Extra args from the
    client are shlex-split and appended — with wrapper-aware forwarding for
    common runners like `cargo run` and `npm start` so generic CLIs behave
    as users expect.
    """
    base: list[str]
    if dep.entrypoint:
        base = list(dep.entrypoint)
    elif dep.start_command:
        base = shlex.split(dep.start_command)
    else:
        base = []
    extra = shlex.split(session_args) if session_args else []
    return _forward_cli_args(base, extra)


def _forward_cli_args(base: list[str], extra: list[str]) -> list[str]:
    """Insert runner delimiters for common package-manager wrapper commands."""
    if not extra:
        return base
    if not base:
        return extra

    if _needs_delimiter(base):
        return base + ["--"] + extra
    return base + extra


def _needs_delimiter(base: list[str]) -> bool:
    if "--" in base:
        return False

    if len(base) >= 2 and base[0] == "cargo" and base[1] == "run":
        return True

    if len(base) >= 2 and base[0] in {"npm", "pnpm", "yarn"} and base[1] in {
        "start",
        "run",
        "dev",
        "exec",
    }:
        return True

    if len(base) >= 3 and base[0] == "bun" and base[1] == "run":
        return True

    return False


@router.websocket("/{deployment_id}/terminal")
async def terminal_ws(ws: WebSocket, deployment_id: str) -> None:
    await ws.accept()

    user = await _authenticate(ws)
    if user is None:
        return

    dep = await _load_deployment(deployment_id, user.id)
    if dep is None:
        await ws.close(code=4404, reason="deployment not found")
        return
    if dep.status != DEPLOYMENT_STATUS_RUNNING:
        await ws.close(code=4409, reason="deployment is not ready yet")
        return
    if not dep.sandbox_id:
        await ws.close(code=4409, reason="deployment has no active sandbox")
        return

    session_args = ws.query_params.get("args")
    try:
        cols = int(ws.query_params.get("cols") or 80)
        rows = int(ws.query_params.get("rows") or 24)
    except ValueError:
        cols, rows = 80, 24
    cols = max(20, min(cols, 400))
    rows = max(5, min(rows, 200))

    argv = _build_argv(dep, session_args)
    if not argv:
        await ws.send_text(json.dumps({
            "type": "error",
            "message": "deployment has no start_command or entrypoint set",
        }))
        await ws.close(code=4400, reason="no entrypoint")
        return

    log.info(
        "terminal open: deployment=%s user=%s argv=%s cols=%d rows=%d",
        deployment_id, user.id, argv, cols, rows,
    )

    try:
        sb = await asyncio.to_thread(Sandbox.from_id, dep.sandbox_id)
    except Exception as e:
        log.exception("terminal: could not attach to sandbox %s", dep.sandbox_id)
        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        await ws.close(code=1011, reason="sandbox attach failed")
        return

    try:
        proc = await asyncio.to_thread(
            sb.exec_pty,
            argv,
            cols=cols,
            rows=rows,
            cwd="/root/.openclaw/workspace/repo",
        )
    except Exception as e:
        log.exception("terminal: exec_pty failed (argv=%s)", argv)
        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        await ws.close(code=1011, reason="exec failed")
        return

    await ws.send_text(json.dumps({"type": "ready", "argv": argv}))

    stop = asyncio.Event()

    async def pump_stdout() -> None:
        """PTY stdout → WebSocket. Runs until the process closes its stdout."""
        try:
            while not stop.is_set():
                chunk = await asyncio.to_thread(_read_chunk, proc.stdout)
                if chunk is None:
                    break
                if not chunk:
                    # Empty non-None means "no data yet but still open" — the
                    # async iterator model would yield; our threaded read
                    # returning empty is a terminator in practice.
                    await asyncio.sleep(0.01)
                    continue
                await ws.send_bytes(chunk)
        except Exception:
            log.exception("terminal: stdout pump crashed")
        finally:
            stop.set()
            try:
                await ws.close()
            except Exception:
                pass

    async def pump_stdin() -> None:
        """WebSocket → PTY stdin. Also handles resize/ctl messages (JSON)."""
        try:
            while not stop.is_set():
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if (data := msg.get("bytes")) is not None:
                    await asyncio.to_thread(proc.stdin.write, data)
                    await asyncio.to_thread(proc.stdin.drain)
                elif (text := msg.get("text")) is not None:
                    # Control frames are JSON; raw text is also forwarded
                    # as-is for clients that can't send binary.
                    parsed = None
                    try:
                        parsed = json.loads(text)
                    except (json.JSONDecodeError, TypeError):
                        pass
                    if isinstance(parsed, dict) and parsed.get("type") == "stdin":
                        payload = parsed.get("data", "")
                        await asyncio.to_thread(
                            proc.stdin.write, payload.encode()
                        )
                        await asyncio.to_thread(proc.stdin.drain)
                    else:
                        await asyncio.to_thread(proc.stdin.write, text.encode())
                        await asyncio.to_thread(proc.stdin.drain)
        except WebSocketDisconnect:
            pass
        except Exception:
            log.exception("terminal: stdin pump crashed")
        finally:
            stop.set()
            try:
                await asyncio.to_thread(proc.stdin.write_eof)
            except Exception:
                pass

    try:
        await asyncio.gather(pump_stdout(), pump_stdin())
    finally:
        log.info("terminal closed: deployment=%s user=%s", deployment_id, user.id)
        # Try to collect the return code without blocking forever.
        try:
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=2)
        except Exception:
            pass


def _read_chunk(stream) -> bytes | None:
    """One blocking read from a modal StreamReader. Returns None on EOF.

    `StreamReader` is its own iterator (`__iter__` returns self), so
    repeated `next()` calls yield consecutive chunks until exhausted.
    """
    try:
        return next(stream)
    except StopIteration:
        return None
    except Exception:
        log.exception("terminal: read error")
        return None


# ---------------------------------------------------------------------------
# SMS terminal interaction — called by photon-backend / Spectrum
# ---------------------------------------------------------------------------

class TerminalInteractRequest(BaseModel):
    input: str = ""


class TerminalInteractResponse(BaseModel):
    output: str


async def _wait_for_output(
    session,
    *,
    max_wait: float = 10.0,
    quiet_period: float = 0.5,
) -> None:
    """Wait until output stops arriving or max_wait elapses."""
    start = time.time()
    last_size = 0
    last_change = start

    while time.time() - start < max_wait:
        current_size = session.buffer_size
        if current_size > last_size:
            last_size = current_size
            last_change = time.time()
        elif current_size > 0 and time.time() - last_change >= quiet_period:
            break
        await asyncio.sleep(0.1)


@router.post(
    "/{deployment_id}/terminal/interact",
    response_model=TerminalInteractResponse,
)
async def terminal_interact(
    deployment_id: str,
    payload: TerminalInteractRequest,
) -> TerminalInteractResponse:
    """Send input to a CLI deployment's terminal and return the output.

    Called by photon-backend for SMS-based terminal interaction.
    No user auth — this is an internal service endpoint.
    """
    dep = await _load_deployment_for_interact(deployment_id)

    session = session_manager.get_session(deployment_id)
    if session is None:
        argv = _build_argv(dep, None)
        if not argv:
            raise HTTPException(
                status_code=400, detail="No entrypoint configured"
            )
        session = await asyncio.to_thread(
            session_manager.create_session,
            deployment_id,
            dep.sandbox_id,
            argv,
        )
        await _wait_for_output(session, max_wait=3.0, quiet_period=1.0)
        initial = session.drain_output()
        if not payload.input:
            return TerminalInteractResponse(output=initial.strip() or "(session started)")

    if payload.input:
        await asyncio.to_thread(session.send_input, payload.input)

    await _wait_for_output(session, max_wait=10.0, quiet_period=0.5)
    output = session.drain_output()

    lines = output.split("\n")
    cleaned = [
        line for line in lines
        if line.strip() != payload.input.strip()
    ]
    output = "\n".join(cleaned).strip()

    return TerminalInteractResponse(output=output or "(no output)")


async def _load_deployment_for_interact(deployment_id: str) -> Deployment:
    async with SessionLocal() as db:
        dep = await db.get(Deployment, deployment_id)
    if dep is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if dep.status != DEPLOYMENT_STATUS_RUNNING:
        raise HTTPException(status_code=409, detail="Deployment is not running")
    if dep.kind != "cli":
        raise HTTPException(
            status_code=400,
            detail="Only CLI deployments support terminal interaction",
        )
    if not dep.sandbox_id:
        raise HTTPException(status_code=409, detail="No active sandbox")
    return dep
