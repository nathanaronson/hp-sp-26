import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import { Spinner } from "@inkjs/ui";
import { AppShell } from "../components/AppShell.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { api, ApiError } from "../lib/api.js";
import { config } from "../lib/config.js";
import { MOCK_TOKEN } from "../lib/mock.js";
import { runOAuthLogin } from "../lib/oauth.js";
import type { AuthMe } from "../lib/types.js";

type Phase =
  | "starting"
  | "waiting_for_browser"
  | "verifying"
  | "done"
  | "failed";

type Props = { token?: string; mock?: boolean };

export function Login({ token: providedToken, mock }: Props) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("starting");
  const [identity, setIdentity] = useState<AuthMe>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (mock) {
          config.set("mock", true);
          config.set("token", MOCK_TOKEN);
          setPhase("verifying");
          const me = await api<AuthMe>("/api/auth/me");
          if (cancelled) return;
          setIdentity(me);
          setPhase("done");
          setTimeout(() => exit(), 400);
          return;
        }

        config.set("mock", false);
        let token = providedToken;
        if (!token) {
          setPhase("waiting_for_browser");
          token = await runOAuthLogin();
        }
        if (cancelled) return;
        config.set("token", token);
        setPhase("verifying");
        const me = await api<AuthMe>("/api/auth/me");
        if (cancelled) return;
        setIdentity(me);
        setPhase("done");
        setTimeout(() => exit(), 400);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : String(err));
        setPhase("failed");
        setTimeout(() => exit(), 50);
        process.exitCode = 1;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providedToken, mock, exit]);

  const body =
    phase === "failed" && error ? (
      <ErrorPanel
        message={error}
        hint="Run `dploy login --token <key>` to paste a key manually."
      />
    ) : phase === "done" && identity ? (
      <Box flexDirection="column">
        <Text color="green">✔ Logged in</Text>
        <Box marginTop={1}>
          <Text>{identity.user.email}</Text>
          <Text dimColor>  ({identity.org.slug})</Text>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        <Box>
          <Spinner />
          <Text> {phaseLabel(phase)}</Text>
        </Box>
        {phase === "waiting_for_browser" ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>
              Complete the login in your browser. Times out after 2 minutes.
            </Text>
          </Box>
        ) : null}
      </Box>
    );

  return (
    <AppShell
      command="login"
      identity={
        identity
          ? { email: identity.user.email, org: identity.org.slug }
          : undefined
      }
      showElapsed={phase === "waiting_for_browser"}
    >
      {body}
    </AppShell>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "starting":
      return "Starting…";
    case "waiting_for_browser":
      return "Waiting for browser…";
    case "verifying":
      return "Verifying token…";
    default:
      return "";
  }
}
