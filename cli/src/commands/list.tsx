import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { Select, Spinner } from "@inkjs/ui";
import { api } from "../lib/api.js";
import { assertAuthed } from "../lib/auth.js";
import type { Deployment } from "../lib/types.js";
import { AppShell } from "../components/AppShell.js";
import { DeploymentDetails } from "../components/DeploymentDetails.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { useAuth } from "../hooks/useAuth.js";
import { errorMessage } from "../lib/errors.js";
import { formatRelativeTime } from "../lib/time.js";

export function List() {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { isAuthed } = useAuth();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        if (!isAuthed) {
          throw new Error("Not logged in. Run `dploy login` first.");
        }

        const result = await api<Deployment[]>("/api/deployments");
        if (cancelled) return;
        setDeployments(result);
        setSelectedIndex(0);
      } catch (err) {
        if (cancelled) return;
        process.exitCode = 1;
        setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (isRawModeSupported) return;
    if (loading) return;
    const timeout = setTimeout(() => exit(), 50);
    return () => clearTimeout(timeout);
  }, [exit, isRawModeSupported, loading]);

  const selected = deployments[selectedIndex];

  return (
    <AppShell
      command="list"
      hints={
        isRawModeSupported
          ? [
              { keys: "↑↓", label: "browse" },
              { keys: "q", label: "quit" },
            ]
          : undefined
      }
    >
      {isRawModeSupported ? (
        <ListInput onExit={exit} />
      ) : null}

      {error ? (
        <ErrorPanel message={error} hint="Run `dploy login --mock` to explore seeded demo deployments." />
      ) : loading ? (
        <Box>
          <Spinner />
          <Text> Fetching deployments…</Text>
        </Box>
      ) : deployments.length === 0 ? (
        <Text dimColor>No deployments yet.</Text>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>
            {deployments.length} deployment{deployments.length === 1 ? "" : "s"}
          </Text>
          {isRawModeSupported ? (
            <Box flexDirection="column">
              <Text bold>{formatRow("Status", "Name", "URL", "Age")}</Text>
              <Select
                options={deployments.map((deployment, index) => ({
                  value: String(index),
                  label: formatRow(
                    deployment.status,
                    deployment.name,
                    deployment.url ?? "pending",
                    formatRelativeTime(deployment.createdAt),
                  ),
                }))}
                visibleOptionCount={Math.min(8, deployments.length)}
                defaultValue={String(selectedIndex)}
                onChange={(value) => setSelectedIndex(Number(value))}
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text bold>{formatRow("Status", "Name", "URL", "Age")}</Text>
              {deployments.map((deployment) => (
                <Text key={deployment.id}>
                  {formatRow(
                    deployment.status,
                    deployment.name,
                    deployment.url ?? "pending",
                    formatRelativeTime(deployment.createdAt),
                  )}
                </Text>
              ))}
            </Box>
          )}

          {selected ? (
            <DeploymentDetails
              deployment={selected}
              showActions={!isRawModeSupported}
            />
          ) : null}
        </Box>
      )}
    </AppShell>
  );
}

export async function listJson(): Promise<void> {
  assertAuthed();
  const deployments = await api<Deployment[]>("/api/deployments");
  console.log(JSON.stringify(deployments, null, 2));
}

function ListInput({
  onExit,
}: {
  onExit: () => void;
}) {
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onExit();
    }
  });

  return null;
}

function formatRow(
  status: string,
  name: string,
  url: string,
  age: string,
): string {
  return [
    fit(status, 12),
    fit(name, 20),
    fit(url, 28),
    fit(age, 10),
  ].join("  ");
}

function fit(value: string, width: number): string {
  if (value.length > width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width, " ");
}
