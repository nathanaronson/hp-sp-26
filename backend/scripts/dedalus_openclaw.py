"""One-off provisioning script: spin up a Dedalus machine, install OpenClaw,
start the gateway, and send a sample chat request.

Usage:  uv run python scripts/dedalus_openclaw.py
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dedalus_sdk import Dedalus  # noqa: E402cccccdbjjkddunlcncffndhfeducfinfdvnctdntlkfd


from app.core.config import get_settings  # noqa: E402

settings = get_settings()
client = Dedalus(api_key=settings.dedalus_api_key)
ANTHROPIC_API_KEY = settings.anthropic_api_key

ENV = (
    "export PATH=/home/machine/.npm-global/bin:$PATH "
    "&& export HOME=/home/machine "
    "&& export OPENCLAW_STATE_DIR=/home/machine/.openclaw "
    "&& export NODE_COMPILE_CACHE=/home/machine/.compile-cache "
    "&& export OPENCLAW_NO_RESPAWN=1"
)


def exec(mid: str, cmd: str, timeout_ms: int = 120_000) -> str:
    exc = client.machines.executions.create(
        machine_id=mid,
        command=["/bin/bash", "-c", cmd],

        timeout_ms=timeout_ms,
    )
    result = exc
    while result.status not in ("succeeded", "failed"):
        time.sleep(1)
        result = client.machines.executions.retrieve(
            machine_id=mid,
            execution_id=exc.execution_id,
        )

    output = client.machines.executions.output(
        machine_id=mid,
        execution_id=exc.execution_id,
    )
    if result.status == "failed":
        raise RuntimeError(output.stderr or "exec failed")
    return (output.stdout or "").strip()


# --- Step 1: Create and wait for machine (with retry on RuntimeWakeFailed) ---
MAX_ATTEMPTS = 1
for attempt in range(1, MAX_ATTEMPTS + 1):
    print(f"Creating machine (attempt {attempt}/{MAX_ATTEMPTS})...")
    dm = client.machines.create(vcpu=2, memory_mib=2048, storage_gib=10)
    mid = dm.machine_id
    print(f"Machine {mid} created (phase: {dm.status.phase})")

    while dm.status.phase not in ("running", "failed"):
        time.sleep(2)
        dm = client.machines.retrieve(machine_id=mid)
        print(f"  phase: {dm.status.phase}")

    if dm.status.phase == "running":
        break

    print(f"Machine failed: {dm.status.reason}")
    if attempt < MAX_ATTEMPTS:
        print("Destroying failed machine and retrying...")
        client.machines.delete(machine_id=mid)
        time.sleep(5)
    else:
        raise RuntimeError(
            f"All {MAX_ATTEMPTS} attempts failed. Last error: {dm.status.reason}"
        )

print("Machine running, waiting for guest agent...")
time.sleep(5)

# --- Step 2: Install Node.js + OpenClaw ---
print("Installing Node.js 22...")
out = exec(
    mid,
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tail -3 "
    "&& apt-get install -y nodejs 2>&1 | tail -3",
)
print(out)

print("Installing OpenClaw...")
out = exec(
    mid,
    "mkdir -p /home/machine/.npm-global /home/machine/.npm-cache "
    "/home/machine/.tmp /home/machine/.openclaw /home/machine/.compile-cache && "
    "NPM_CONFIG_PREFIX=/home/machine/.npm-global "
    "NPM_CONFIG_CACHE=/home/machine/.npm-cache "
    "TMPDIR=/home/machine/.tmp "
    "npm install -g openclaw@latest 2>&1 | tail -5",
    timeout_ms=300_000,
)
print(out)

print("Verifying OpenClaw...")
out = exec(mid, f"{ENV} && openclaw --version")
print(f"OpenClaw version: {out}")

# --- Step 3: Configure ---
print("Configuring OpenClaw...")
exec(mid, f"{ENV} && openclaw config set gateway.mode local")
if ANTHROPIC_API_KEY:
    exec(
        mid,
        f'{ENV} && openclaw config set env.vars.ANTHROPIC_API_KEY "{ANTHROPIC_API_KEY}"',
    )
else:
    print("WARNING: ANTHROPIC_API_KEY not set, skipping LLM key configuration")
exec(
    mid,
    f"{ENV} && openclaw config set gateway.http.endpoints.chatCompletions.enabled true",
)
print("Configuration complete")

# --- Step 4: Start the gateway ---
print("Writing startup script...")
exec(
    mid,
    "echo '#!/bin/bash' > /home/machine/start-gateway.sh && "
    "echo 'export PATH=/home/machine/.npm-global/bin:$PATH' >> /home/machine/start-gateway.sh && "
    "echo 'export HOME=/home/machine' >> /home/machine/start-gateway.sh && "
    "echo 'export OPENCLAW_STATE_DIR=/home/machine/.openclaw' "
    ">> /home/machine/start-gateway.sh && "
    "echo 'export NODE_COMPILE_CACHE=/home/machine/.compile-cache' "
    ">> /home/machine/start-gateway.sh && "
    "echo 'export OPENCLAW_NO_RESPAWN=1' >> /home/machine/start-gateway.sh && "
    "echo 'exec openclaw gateway run --auth none "
    "> /home/machine/.openclaw/gateway.log 2>&1' "
    ">> /home/machine/start-gateway.sh && "
    "chmod +x /home/machine/start-gateway.sh",
)

print("Launching gateway...")
out = exec(
    mid,
    "pgrep -f openclaw-gateway > /dev/null && echo 'already running' || "
    "(setsid /home/machine/start-gateway.sh </dev/null &>/dev/null & disown "
    "&& sleep 10 && echo 'launched')",
)
print(f"Gateway: {out}")

# --- Step 5: Verify ---
print("Verifying...")
out = exec(mid, "ss -tlnp | grep 18789")
print(f"Port check: {out}")

out = exec(mid, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/")
print(f"HTTP status: {out}")

out = exec(mid, f"{ENV} && openclaw gateway call health")
print(f"Health: {out}")

# --- Step 6: Chat ---
print("\nSending chat message...")
chat_payload = json.dumps(
    {
        "model": "openclaw/default",
        "messages": [{"role": "user", "content": "Hello! What are you?"}],
    }
)
response = exec(
    mid,
    "curl -sS http://127.0.0.1:18789/v1/chat/completions "
    "-H 'Content-Type: application/json' "
    f"-d '{chat_payload}'",
    timeout_ms=120_000,
)
parsed = json.loads(response)
print(f"\nAssistant: {parsed['choices'][0]['message']['content']}")

print(f"\nDone! Machine ID: {mid}")
