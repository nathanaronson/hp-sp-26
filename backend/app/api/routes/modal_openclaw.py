import json
import sys

import modal

from app.core.config import get_settings

settings = get_settings()
ANTHROPIC_API_KEY = "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"
OPENAI_API_KEY = "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"

ENV = (
    "export PATH=/root/.npm-global/bin:$PATH "
    "&& export HOME=/root "
    "&& export OPENCLAW_STATE_DIR=/root/.openclaw "
    "&& export NODE_COMPILE_CACHE=/root/.compile-cache "
    "&& export OPENCLAW_NO_RESPAWN=1"
)


def run(sb: modal.Sandbox, cmd: str, timeout: int = 120, stream: bool = False) -> str:
    """Run a bash command in the sandbox, return stdout, raise on failure."""
    p = sb.exec("bash", "-c", cmd, timeout=timeout)
    if stream:
        chunks = []
        for line in p.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            chunks.append(line)
        stdout = "".join(chunks)
    else:
        stdout = p.stdout.read()
    stderr = p.stderr.read()
    p.wait()
    if p.returncode != 0:
        out = sb.exec("tail -n 100 /root/.openclaw/gateway.log", timeout=timeout)
        print(out)

        raise RuntimeError(f"Command failed (exit {p.returncode}):\n{stderr}")
    return stdout.strip()


# --- Step 1: Create sandbox with Node.js + OpenClaw baked into the image ---
print("Creating Modal sandbox...")
sb_app = modal.App.lookup("openclaw-sandbox", create_if_missing=True)

image = (
    modal.Image.debian_slim()
    .apt_install("curl", "git")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -")
    .apt_install("nodejs")
    .run_commands(
        "mkdir -p /root/.npm-global /root/.npm-cache /root/.openclaw /root/.compile-cache",
        "NPM_CONFIG_PREFIX=/root/.npm-global NPM_CONFIG_CACHE=/root/.npm-cache "
        "npm install -g openclaw@latest",
    )
    .env({
        "PATH": "/root/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME": "/root",
        "OPENCLAW_STATE_DIR": "/root/.openclaw",
        "NODE_COMPILE_CACHE": "/root/.compile-cache",
        "OPENCLAW_NO_RESPAWN": "1",
    })
)

with modal.enable_output():
    sb = modal.Sandbox.create(
        image=image,
        app=sb_app,
        timeout=30 * 60,
    )

print(f"Sandbox created: {sb.object_id}")

# --- Step 2: Verify OpenClaw ---
print("Verifying OpenClaw...")
out = run(sb, "openclaw --version")
print(f"OpenClaw version: {out}")

# --- Step 3: Configure ---
print("Configuring OpenClaw...")
run(sb, "openclaw config set gateway.mode local")
if ANTHROPIC_API_KEY:
    run(sb, f'openclaw config set env.vars.ANTHROPIC_API_KEY "{ANTHROPIC_API_KEY}"')
if OPENAI_API_KEY:
    run(sb, f'openclaw config set env.vars.OPENAI_API_KEY "{OPENAI_API_KEY}"')
else:
    print("WARNING: ANTHROPIC_API_KEY not set, skipping LLM key configuration")
run(sb, "openclaw config set gateway.http.endpoints.chatCompletions.enabled true")
print("Configuration complete")

# --- Step 4: Start the gateway ---
print("Starting gateway...")
run(
    sb,
    "nohup openclaw gateway run --auth none > /root/.openclaw/gateway.log 2>&1 &\n"
    "sleep 10",
    timeout=60,
)

# --- Step 5: Verify ---
print("Verifying...")
out = run(sb, "ss -tlnp | grep 18789 || true")
print(f"Port check: {out}")

out = run(sb, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/")
print(f"HTTP status: {out}")

out = run(sb, "openclaw gateway call health")
print(f"Health: {out}")

# out = run(sb, "openclaw doctor --fix")
# print(f"Doctor: {out}")

# --- Step 6: Chat ---
print("\nSending chat message...")
response = run(
    sb,
    "curl -sS http://127.0.0.1:18789/v1/chat/completions "
    "-H 'Content-Type: application/json' "
    """-d '{"model":"openclaw/default","messages":[{"role":"user","content":"Hello! What are you?"}]}'""",
    timeout=120,
)
try:
    parsed = json.loads(response)
    if "choices" in parsed:
        print(f"\nAssistant: {parsed['choices'][0]['message']['content']}")
    else:
        print(f"\nChat response (no choices):\n{json.dumps(parsed, indent=2)}")
except json.JSONDecodeError:
    print(f"\nRaw response:\n{response}")

print(f"\nDone! Sandbox ID: {sb.object_id}")

sb.terminate()
sb.detach()
