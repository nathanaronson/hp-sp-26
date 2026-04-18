import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { Spinner } from "@inkjs/ui";
import { api } from "../lib/api.js";
import { assertAuthed } from "../lib/auth.js";
import type { Deployment } from "../lib/types.js";
import { AppShell } from "../components/AppShell.js";
import { DeploymentDetails } from "../components/DeploymentDetails.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { useAuth } from "../hooks/useAuth.js";
import { errorMessage } from "../lib/errors.js";

export function Status({ id }: { id: string }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { isAuthed } = useAuth();
  const [deployment, setDeployment] = useState<Deployment>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        if (!isAuthed) {
          throw new Error("Not logged in. Run `dploy login` first.");
        }

        const result = await api<Deployment>(`/api/deployments/${id}`);
        if (cancelled) return;
        setDeployment(result);
      } catch (err) {
        if (cancelled) return;
        process.exitCode = 1;
        setError(errorMessage(err));
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [id, isAuthed]);

  useEffect(() => {
    if (isRawModeSupported) return;
    if (!deployment && !error) return;
    const timeout = setTimeout(() => exit(), 50);
    return () => clearTimeout(timeout);
  }, [deployment, error, exit, isRawModeSupported]);

  return (
    <AppShell
      command={`status ${id}`}
      hints={isRawModeSupported ? [{ keys: "q", label: "quit" }] : undefined}
    >
      {isRawModeSupported ? <QuitInput onExit={exit} /> : null}
      {error ? (
        <ErrorPanel message={error} hint="Try `dploy list` to find a valid deployment ID." />
      ) : deployment ? (
        <DeploymentDetails deployment={deployment} showActions={false} />
      ) : (
        <Box>
          <Spinner />
          <Text> Fetching deployment…</Text>
        </Box>
      )}
    </AppShell>
  );
}

export async function statusJson(id: string): Promise<void> {
  assertAuthed();
  const deployment = await api<Deployment>(`/api/deployments/${id}`);
  console.log(JSON.stringify(deployment, null, 2));
}

function QuitInput({ onExit }: { onExit: () => void }) {
  useInput((input, key) => {
    if (input === "q" || key.escape) onExit();
  });

  return null;
}
