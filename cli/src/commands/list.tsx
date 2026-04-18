import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { Spinner } from "@inkjs/ui";
import { api } from "../lib/api.js";
import type { Deployment } from "../lib/types.js";
import { AppShell } from "../components/AppShell.js";
import { DeploymentDetails } from "../components/DeploymentDetails.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { Table } from "../components/Table.js";
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
              { keys: "↑↓", label: "select" },
              { keys: "j/k", label: "move" },
              { keys: "q", label: "quit" },
            ]
          : undefined
      }
    >
      {isRawModeSupported ? (
        <ListInput
          count={deployments.length}
          onExit={exit}
          onMove={(delta) =>
            setSelectedIndex((current) =>
              clampIndex(current + delta, deployments.length),
            )
          }
        />
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

          <Box marginTop={1}>
            <Table
              columns={[
                { header: "Status", width: 14, render: (row) => row.status },
                { header: "Name", width: 22, render: (row) => row.name },
                {
                  header: "URL",
                  width: 30,
                  render: (row) => row.url ?? "pending",
                },
                {
                  header: "Age",
                  width: 10,
                  render: (row) => formatRelativeTime(row.createdAt),
                },
              ]}
              rows={deployments}
              selectedIndex={isRawModeSupported ? selectedIndex : undefined}
            />
          </Box>

          {selected ? (
            <Box marginTop={1}>
              <DeploymentDetails
                deployment={selected}
                showActions={!isRawModeSupported}
              />
            </Box>
          ) : null}
        </Box>
      )}
    </AppShell>
  );
}

function ListInput({
  count,
  onExit,
  onMove,
}: {
  count: number;
  onExit: () => void;
  onMove: (delta: number) => void;
}) {
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onExit();
      return;
    }

    if (count === 0) return;
    if (key.upArrow || input === "k") onMove(-1);
    if (key.downArrow || input === "j") onMove(1);
  });

  return null;
}

function clampIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  if (value < 0) return count - 1;
  if (value >= count) return 0;
  return value;
}
