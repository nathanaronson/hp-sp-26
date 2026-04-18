import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { Spinner } from "@inkjs/ui";
import { api } from "../lib/api.js";
import type { Deployment } from "../lib/types.js";
import { AppShell } from "../components/AppShell.js";
import { DeploymentDetails } from "../components/DeploymentDetails.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { useAuth } from "../hooks/useAuth.js";
import { errorMessage } from "../lib/errors.js";

type Phase = "loading" | "confirm" | "stopping" | "done" | "cancelled" | "failed";

export function Stop({ id, yes = false }: { id: string; yes?: boolean }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { isAuthed } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [deployment, setDeployment] = useState<Deployment>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Deployment>();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        if (!isAuthed) {
          throw new Error("Not logged in. Run `dploy login` first.");
        }

        const found = await api<Deployment>(`/api/deployments/${id}`);
        if (cancelled) return;
        setDeployment(found);

        if (yes) {
          void stopDeployment();
          return;
        }

        if (!isRawModeSupported) {
          throw new Error("Confirmation requires an interactive terminal. Re-run with `dploy stop <id> --yes`.");
        }

        setPhase("confirm");
      } catch (err) {
        if (cancelled) return;
        process.exitCode = 1;
        setError(errorMessage(err));
        setPhase("failed");
      }
    }

    async function stopDeployment(): Promise<void> {
      try {
        setPhase("stopping");
        const stopped = await api<Deployment>(`/api/deployments/${id}`, {
          method: "DELETE",
        });
        if (cancelled) return;
        setResult(stopped);
        setPhase("done");
      } catch (err) {
        if (cancelled) return;
        process.exitCode = 1;
        setError(errorMessage(err));
        setPhase("failed");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, isAuthed, isRawModeSupported, yes]);

  useEffect(() => {
    if (phase !== "done" && phase !== "failed" && phase !== "cancelled") return;
    const timeout = setTimeout(() => exit(), 1400);
    return () => clearTimeout(timeout);
  }, [exit, phase]);

  return (
    <AppShell
      command={`stop ${id}`}
      hints={
        phase === "confirm" && isRawModeSupported
          ? [
              { keys: "y", label: "confirm" },
              { keys: "n", label: "cancel" },
            ]
          : undefined
      }
    >
      {phase === "confirm" && deployment && isRawModeSupported ? (
        <StopInput
          onCancel={() => {
            setPhase("cancelled");
          }}
          onConfirm={async () => {
            try {
              setPhase("stopping");
              const stopped = await api<Deployment>(`/api/deployments/${id}`, {
                method: "DELETE",
              });
              setResult(stopped);
              setPhase("done");
            } catch (err) {
              process.exitCode = 1;
              setError(errorMessage(err));
              setPhase("failed");
            }
          }}
        />
      ) : null}

      {error ? (
        <ErrorPanel message={error} hint="Use `dploy list` to check deployment IDs before stopping." />
      ) : phase === "loading" ? (
        <Box>
          <Spinner />
          <Text> Loading deployment…</Text>
        </Box>
      ) : phase === "stopping" ? (
        <Box>
          <Spinner />
          <Text> Stopping deployment…</Text>
        </Box>
      ) : phase === "done" && result ? (
        <Box flexDirection="column">
          <Text color="green">✔ Deployment stopped.</Text>
          <DeploymentDetails deployment={result} showActions={false} />
        </Box>
      ) : phase === "cancelled" ? (
        <Text dimColor>Stop cancelled.</Text>
      ) : deployment ? (
        <Box flexDirection="column">
          <Text>Stop this deployment?</Text>
          <DeploymentDetails deployment={deployment} showActions={false} />
        </Box>
      ) : null}
    </AppShell>
  );
}

function StopInput({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    if (input === "y") void onConfirm();
    if (input === "n" || input === "q" || key.escape) onCancel();
  });

  return null;
}
