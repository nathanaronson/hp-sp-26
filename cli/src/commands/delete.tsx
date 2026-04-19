import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { ConfirmInput, Spinner } from "@inkjs/ui";
import { api } from "../lib/api.js";
import type { Deployment } from "../lib/types.js";
import { AppShell } from "../components/AppShell.js";
import { DeploymentDetails } from "../components/DeploymentDetails.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { useAuth } from "../hooks/useAuth.js";
import { errorMessage } from "../lib/errors.js";

type Phase = "loading" | "confirm" | "deleting" | "done" | "cancelled" | "failed";

export function DeleteDeployment({ id, yes = false }: { id: string; yes?: boolean }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { isAuthed } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [deployment, setDeployment] = useState<Deployment>();
  const [error, setError] = useState<string>();

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
          void deleteDeployment();
          return;
        }

        if (!isRawModeSupported) {
          throw new Error("Confirmation requires an interactive terminal. Re-run with `dploy delete <id> --yes`.");
        }

        setPhase("confirm");
      } catch (err) {
        if (cancelled) return;
        process.exitCode = 1;
        setError(errorMessage(err));
        setPhase("failed");
      }
    }

    async function deleteDeployment(): Promise<void> {
      try {
        setPhase("deleting");
        await api<void>(`/api/deployments/${id}/record`, {
          method: "DELETE",
        });
        if (cancelled) return;
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
      command={`delete ${id}`}
      hints={
        phase === "confirm" && isRawModeSupported
          ? [
              { keys: "y", label: "confirm" },
              { keys: "n", label: "cancel" },
              { keys: "enter", label: "default" },
            ]
          : undefined
      }
    >
      {error ? (
        <ErrorPanel message={error} hint="Use `dploy list` to check deployment IDs before deleting." />
      ) : phase === "loading" ? (
        <Box>
          <Spinner />
          <Text> Loading deployment…</Text>
        </Box>
      ) : phase === "deleting" ? (
        <Box>
          <Spinner />
          <Text> Deleting deployment…</Text>
        </Box>
      ) : phase === "done" ? (
        <Text color="green">✔ Deployment deleted.</Text>
      ) : phase === "cancelled" ? (
        <Text dimColor>Delete cancelled.</Text>
      ) : deployment ? (
        <Box flexDirection="column">
          <Text>Delete this deployment permanently?</Text>
          <DeploymentDetails deployment={deployment} showActions={false} />
          <Box>
            <Text dimColor>Confirm: </Text>
            <DeleteInput
              onCancel={() => {
                setPhase("cancelled");
              }}
              onConfirm={async () => {
                try {
                  setPhase("deleting");
                  await api<void>(`/api/deployments/${id}/record`, {
                    method: "DELETE",
                  });
                  setPhase("done");
                } catch (err) {
                  process.exitCode = 1;
                  setError(errorMessage(err));
                  setPhase("failed");
                }
              }}
            />
          </Box>
        </Box>
      ) : null}
    </AppShell>
  );
}

function DeleteInput({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    if (input === "q" || key.escape) onCancel();
  });

  return (
    <ConfirmInput
      defaultChoice="cancel"
      submitOnEnter
      onConfirm={() => {
        void onConfirm();
      }}
      onCancel={onCancel}
    />
  );
}
