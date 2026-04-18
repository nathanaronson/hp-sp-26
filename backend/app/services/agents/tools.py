"""Tool schemas exposed to the deployment agents.

These are the *contracts* the LLM sees. The actual implementations live
elsewhere (they shell out to the Dedalus VM via the executions API). The
prompts in `prompts.py` reference these names and parameters verbatim, so
keep names stable.

Two principles:

1. Read-only tools are cheap and idempotent. Encourage their use.
2. `run_command` is powerful but expensive (network round-trip + a real
   shell on the VM). The prompt biases the agent toward `read_file`,
   `list_dir`, `list_listening_ports` first.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Shared filesystem + shell tools (used by both agents)
# ---------------------------------------------------------------------------

LIST_DIR: dict[str, Any] = {
    "name": "list_dir",
    "description": (
        "List entries in a directory inside the user's project. Returns one "
        "line per entry: '<type> <size_bytes> <path>' where type is 'd', 'f', "
        "or 'l'. Hidden files are included. Use this before reading files so "
        "you know what's there."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "Absolute path inside the VM. The project root is "
                    "/home/machine/repo. Default: project root."
                ),
                "default": "/home/machine/repo",
            },
            "max_depth": {
                "type": "integer",
                "description": "Recursion depth. 1 = just this dir.",
                "default": 2,
                "minimum": 1,
                "maximum": 4,
            },
        },
        "required": [],
    },
}

READ_FILE: dict[str, Any] = {
    "name": "read_file",
    "description": (
        "Read a UTF-8 text file from the VM. Truncated past max_bytes (default "
        "20 KB). Prefer this over `run_command cat ...` — it's cheaper and "
        "won't accidentally trigger shell expansion."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path inside the VM.",
            },
            "max_bytes": {
                "type": "integer",
                "default": 20_000,
                "minimum": 256,
                "maximum": 200_000,
            },
        },
        "required": ["path"],
    },
}

RUN_COMMAND: dict[str, Any] = {
    "name": "run_command",
    "description": (
        "Run a shell command in the VM and wait for it to finish. Returns "
        "{exit_code, stdout, stderr}. Use for quick foreground commands like "
        "`pnpm install`, `cat package.json | jq .scripts`, `node --version`. "
        "Do NOT use to start long-running servers — use "
        "`run_command_background` for that. Output is truncated to ~16 KB "
        "per stream."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": (
                    "Single shell command line, executed via `bash -c`. "
                    "Project root is /home/machine/repo and is the default cwd."
                ),
            },
            "timeout_s": {
                "type": "integer",
                "default": 60,
                "minimum": 1,
                "maximum": 600,
            },
            "cwd": {
                "type": "string",
                "default": "/home/machine/repo",
            },
        },
        "required": ["command"],
    },
}

RUN_COMMAND_BACKGROUND: dict[str, Any] = {
    "name": "run_command_background",
    "description": (
        "Start a long-running command in the background (e.g. a web server). "
        "Returns immediately with a `process_id` you can later inspect via "
        "`list_processes` and a `log_path` you can `read_file`. The command is "
        "wrapped in `nohup ... > <log_path> 2>&1 &` and detached from the "
        "session, so you don't need to add `&` yourself."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The server start command, e.g. `pnpm start`.",
            },
            "cwd": {
                "type": "string",
                "default": "/home/machine/repo",
            },
            "env": {
                "type": "object",
                "description": "Extra env vars merged into the process env.",
                "additionalProperties": {"type": "string"},
            },
        },
        "required": ["command"],
    },
}

LIST_PROCESSES: dict[str, Any] = {
    "name": "list_processes",
    "description": (
        "List running processes (rough equivalent of `ps -eo pid,comm,args`). "
        "Use after `run_command_background` to confirm your server is alive."
    ),
    "input_schema": {"type": "object", "properties": {}, "required": []},
}

LIST_LISTENING_PORTS: dict[str, Any] = {
    "name": "list_listening_ports",
    "description": (
        "List TCP ports the VM is currently listening on. Returns rows of "
        "`{port, address, pid, command}`. This is your primary signal for "
        "Agent #2 — once the server starts, the port shows up here."
    ),
    "input_schema": {"type": "object", "properties": {}, "required": []},
}

CURL: dict[str, Any] = {
    "name": "curl",
    "description": (
        "Send an HTTP request from inside the VM (so you can hit "
        "127.0.0.1:<port>). Returns {status_code, headers, body_preview}. "
        "Body is truncated to 4 KB."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {"type": "string"},
            "method": {
                "type": "string",
                "enum": ["GET", "HEAD", "POST"],
                "default": "GET",
            },
            "follow_redirects": {"type": "boolean", "default": True},
            "timeout_s": {"type": "integer", "default": 5, "maximum": 30},
        },
        "required": ["url"],
    },
}

# ---------------------------------------------------------------------------
# Terminal tools — every agent run MUST end with one of these.
# ---------------------------------------------------------------------------

REPORT_INSTALL_PLAN: dict[str, Any] = {
    "name": "report_install_plan",
    "description": (
        "Final answer for Agent #1. Call this exactly once, after you're "
        "confident in the install + start commands. Do not run them yourself "
        "— Agent #2 will. Calling this ends the agent loop."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "runtime": {
                "type": "string",
                "enum": [
                    "node",
                    "python",
                    "go",
                    "rust",
                    "ruby",
                    "java",
                    "static",
                    "docker",
                    "unknown",
                ],
            },
            "package_manager": {
                "type": "string",
                "enum": ["npm", "pnpm", "yarn", "bun", "pip", "uv", "poetry", "go", "cargo", "bundler", "maven", "none"],
                "default": "none",
            },
            "install_commands": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Ordered shell commands Agent #2 will run before starting "
                    "the app. Empty list is fine for static sites. Each "
                    "command is run via `bash -c` from the project root."
                ),
            },
            "start_command": {
                "type": "string",
                "description": (
                    "The single command that starts the long-running server. "
                    "MUST bind to 0.0.0.0 (not 127.0.0.1) where the framework "
                    "supports it — include the flag if needed (e.g. "
                    "`--host 0.0.0.0`, `-H 0.0.0.0`, `HOST=0.0.0.0`)."
                ),
            },
            "port_hint": {
                "type": ["integer", "null"],
                "description": (
                    "Best guess at the port the server will bind to, from "
                    "package.json scripts, framework defaults, or explicit "
                    "config. null if unknown."
                ),
            },
            "env_required": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Environment variable NAMES the app reads (from .env.example, "
                    "config files, or grep'd usage) and that aren't already set. "
                    "Don't include values."
                ),
            },
            "build_commands": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional build step that must run after install but "
                    "before start (e.g. `pnpm build`, `cargo build --release`)."
                ),
                "default": [],
            },
            "notes": {
                "type": "string",
                "description": "1–2 sentences explaining the choice.",
            },
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
            },
        },
        "required": [
            "runtime",
            "install_commands",
            "start_command",
            "notes",
            "confidence",
        ],
    },
}

REPORT_PORT: dict[str, Any] = {
    "name": "report_port",
    "description": (
        "Final answer for Agent #2. Call this exactly once, after you've "
        "started the server and confirmed it serves a 2xx/3xx HTTP response "
        "on a TCP port bound to 0.0.0.0. Calling this ends the agent loop."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "port": {
                "type": "integer",
                "minimum": 1,
                "maximum": 65535,
                "description": "The TCP port to expose publicly.",
            },
            "protocol": {
                "type": "string",
                "enum": ["http", "https", "tcp"],
                "default": "http",
            },
            "bound_address": {
                "type": "string",
                "description": (
                    "The address the server is bound to as seen in "
                    "`list_listening_ports` (e.g. `0.0.0.0`, `*`, `::`). If "
                    "the server is bound only to 127.0.0.1, you must restart "
                    "it with the right flag — that port is NOT publicly "
                    "reachable."
                ),
            },
            "health_path": {
                "type": "string",
                "default": "/",
                "description": (
                    "Path that returned a 2xx or 3xx response during your "
                    "verification curl."
                ),
            },
            "http_status": {
                "type": "integer",
                "minimum": 100,
                "maximum": 599,
            },
            "process_id": {
                "type": ["integer", "null"],
                "description": (
                    "PID of the running server, from `list_processes`. Used "
                    "by the controller to teardown later."
                ),
            },
            "notes": {"type": "string"},
        },
        "required": ["port", "bound_address", "http_status", "notes"],
    },
}

REPORT_FAILURE: dict[str, Any] = {
    "name": "report_failure",
    "description": (
        "Call this if you cannot complete your task after reasonable effort. "
        "Be specific about what blocked you so the user can fix it. Calling "
        "this ends the agent loop."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason_code": {
                "type": "string",
                "enum": [
                    "no_runnable_app",
                    "install_failed",
                    "build_failed",
                    "start_failed",
                    "no_port_detected",
                    "port_only_localhost",
                    "missing_env_var",
                    "timeout",
                    "other",
                ],
            },
            "message": {
                "type": "string",
                "description": (
                    "Human-readable explanation, ~1–3 sentences. Mention the "
                    "concrete file/command/error you saw."
                ),
            },
            "evidence": {
                "type": "string",
                "description": "Relevant log lines or error output, if any.",
            },
        },
        "required": ["reason_code", "message"],
    },
}

# ---------------------------------------------------------------------------
# Toolkit groupings
# ---------------------------------------------------------------------------

ANALYZE_TOOLS: list[dict[str, Any]] = [
    LIST_DIR,
    READ_FILE,
    RUN_COMMAND,
    REPORT_INSTALL_PLAN,
    REPORT_FAILURE,
]

EXPOSE_TOOLS: list[dict[str, Any]] = [
    LIST_DIR,
    READ_FILE,
    RUN_COMMAND,
    RUN_COMMAND_BACKGROUND,
    LIST_PROCESSES,
    LIST_LISTENING_PORTS,
    CURL,
    REPORT_PORT,
    REPORT_FAILURE,
]
