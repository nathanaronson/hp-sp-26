"""Persistent terminal sessions for SMS-based CLI interaction.

Manages long-lived PTY processes inside Modal sandboxes, allowing
text-message clients (via photon-backend / Spectrum) to send input
and receive output across multiple HTTP requests.

Each session is keyed by deployment_id. When a new message comes in
for a deployment, we reuse the existing PTY if it's still alive, or
spawn a fresh one.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, field

from app.services.sandbox import Sandbox

log = logging.getLogger(__name__)

_ANSI_RE = re.compile(
    r"\x1b\[[0-9;]*[a-zA-Z]"
    r"|\x1b\].*?\x07"
    r"|\x1b[()][AB012]"
    r"|\x1b\[\?[0-9;]*[hlm]"
    r"|\r"
)


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences and carriage returns from terminal output."""
    return _ANSI_RE.sub("", text)


@dataclass
class TerminalSession:
    deployment_id: str
    sandbox_id: str
    proc: object  # modal ContainerProcess
    _buffer: list[bytes] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _reader_thread: threading.Thread | None = field(default=None, repr=False)
    _alive: bool = True
    created_at: float = field(default_factory=time.time)

    def start_reader(self) -> None:
        self._reader_thread = threading.Thread(
            target=self._read_loop,
            name=f"sms-terminal-reader[{self.deployment_id[:8]}]",
            daemon=True,
        )
        self._reader_thread.start()

    def _read_loop(self) -> None:
        try:
            for chunk in self.proc.stdout:
                if not self._alive:
                    break
                if chunk:
                    with self._lock:
                        self._buffer.append(
                            chunk if isinstance(chunk, bytes) else chunk.encode()
                        )
        except StopIteration:
            pass
        except Exception:
            log.exception(
                "sms terminal reader crashed (dep=%s)", self.deployment_id[:8]
            )
        finally:
            self._alive = False

    @property
    def buffer_size(self) -> int:
        with self._lock:
            return sum(len(b) for b in self._buffer)

    def drain_output(self) -> str:
        with self._lock:
            data = b"".join(self._buffer)
            self._buffer.clear()
        raw = data.decode("utf-8", errors="replace")
        return strip_ansi(raw)

    def send_input(self, text: str) -> None:
        if not self._alive:
            raise RuntimeError("Terminal session is no longer alive")
        raw = (text + "\n").encode("utf-8")
        self.proc.stdin.write(raw)
        self.proc.stdin.drain()

    def close(self) -> None:
        self._alive = False
        try:
            self.proc.stdin.write_eof()
        except Exception:
            pass

    @property
    def is_alive(self) -> bool:
        return self._alive


class TerminalSessionManager:
    """Singleton that manages persistent terminal sessions keyed by deployment_id."""

    def __init__(self) -> None:
        self._sessions: dict[str, TerminalSession] = {}
        self._lock = threading.Lock()

    def get_session(self, deployment_id: str) -> TerminalSession | None:
        with self._lock:
            session = self._sessions.get(deployment_id)
            if session and not session.is_alive:
                del self._sessions[deployment_id]
                return None
            return session

    def create_session(
        self,
        deployment_id: str,
        sandbox_id: str,
        argv: list[str],
        cwd: str = "/root/.openclaw/workspace/repo",
    ) -> TerminalSession:
        sb = Sandbox.from_id(sandbox_id)
        proc = sb.exec_pty(argv, cwd=cwd)
        session = TerminalSession(
            deployment_id=deployment_id,
            sandbox_id=sandbox_id,
            proc=proc,
        )
        session.start_reader()
        with self._lock:
            old = self._sessions.get(deployment_id)
            if old:
                old.close()
            self._sessions[deployment_id] = session
        log.info(
            "sms terminal session created: dep=%s argv=%s",
            deployment_id[:8],
            argv,
        )
        return session

    def remove_session(self, deployment_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(deployment_id, None)
        if session:
            session.close()
            log.info("sms terminal session removed: dep=%s", deployment_id[:8])


session_manager = TerminalSessionManager()
