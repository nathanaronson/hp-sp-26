import { env } from "./config/env.js";

/**
 * Calls the Python backend's terminal interact endpoint. With an empty
 * input, the backend spawns a fresh PTY for the deployment and returns
 * the initial output. With a non-empty input, the keystrokes are sent
 * to the existing session and the resulting output is returned.
 */
export async function interactWithTerminal(
  deploymentId: string,
  input: string,
): Promise<string> {
  const url = `${env.BACKEND_URL}/api/v1/deployments/${deploymentId}/terminal/interact`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.detail || `Backend returned ${res.status}`);
  }

  const data = (await res.json()) as { output: string };
  return data.output;
}
