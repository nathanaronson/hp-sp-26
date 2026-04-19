import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { Select, Spinner } from "@inkjs/ui";
import open from "open";
import { api } from "../lib/api.js";
import { assertAuthed } from "../lib/auth.js";
import type { Deployment } from "../lib/types.js";
import { AppShell } from "../components/AppShell.js";
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
  const [actionError, setActionError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [confirmStopId, setConfirmStopId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [startingId, setStartingId] = useState<string>();
  const [stoppingId, setStoppingId] = useState<string>();

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
  const canOpenSelected = Boolean(selected?.url && selected.status === "running");
  const toggleLabel = selected ? startStopLabel(selected) : "start/stop";

  return (
    <AppShell
      command="list"
      hints={
        isRawModeSupported
          ? confirmDeleteId
            ? [
                { keys: "y", label: "confirm delete" },
                { keys: "n", label: "cancel" },
                { keys: "q", label: "quit" },
              ]
            : confirmStopId
            ? [
                { keys: "y", label: "confirm stop" },
                { keys: "n", label: "cancel" },
                { keys: "q", label: "quit" },
              ]
            : [
                { keys: "↑↓", label: "browse" },
                ...(canOpenSelected ? [{ keys: "o", label: "open" }] : []),
                { keys: "s", label: toggleLabel },
                { keys: "d", label: "delete" },
                { keys: "a", label: showAdvanced ? "hide advanced" : "advanced" },
                { keys: "q", label: "quit" },
              ]
          : undefined
      }
    >
      {isRawModeSupported ? (
        <ListInput
          confirmDeleteId={confirmDeleteId}
          confirmStopId={confirmStopId}
          deployment={selected}
          onExit={exit}
          onRequestDelete={() => {
            if (!selected) return;
            setActionError(undefined);
            setConfirmStopId(undefined);
            setConfirmDeleteId(selected.id);
          }}
          onRequestToggle={async () => {
            if (!selected) return;
            if (shouldStart(selected)) {
              try {
                setStartingId(selected.id);
                setActionError(undefined);
                const started = await api<Deployment>(`/api/deployments/${selected.id}/start`, {
                  method: "POST",
                });
                setDeployments((current) =>
                  current.map((deployment) =>
                    deployment.id === started.id ? started : deployment,
                  ),
                );
              } catch (err) {
                process.exitCode = 1;
                setActionError(errorMessage(err));
              } finally {
                setStartingId(undefined);
              }
              return;
            }

            setActionError(undefined);
            setConfirmDeleteId(undefined);
            setConfirmStopId(selected.id);
          }}
          onConfirmDelete={async () => {
            if (!selected || confirmDeleteId !== selected.id) return;
            try {
              setDeletingId(selected.id);
              setActionError(undefined);
              const deletedIndex = selectedIndex;
              await api<void>(`/api/deployments/${selected.id}/record`, {
                method: "DELETE",
              });
              setDeployments((current) => {
                const next = current.filter((deployment) => deployment.id !== selected.id);
                setSelectedIndex(
                  next.length === 0 ? 0 : Math.min(deletedIndex, next.length - 1),
                );
                return next;
              });
              setConfirmDeleteId(undefined);
            } catch (err) {
              process.exitCode = 1;
              setActionError(errorMessage(err));
            } finally {
              setDeletingId(undefined);
            }
          }}
          onCancelDelete={() => {
            setConfirmDeleteId(undefined);
          }}
          onConfirmStop={async () => {
            if (!selected || confirmStopId !== selected.id) return;
            try {
              setStoppingId(selected.id);
              setActionError(undefined);
              const stopped = await api<Deployment>(`/api/deployments/${selected.id}`, {
                method: "DELETE",
              });
              setDeployments((current) =>
                current.map((deployment) =>
                  deployment.id === stopped.id ? stopped : deployment,
                ),
              );
              setConfirmStopId(undefined);
            } catch (err) {
              process.exitCode = 1;
              setActionError(errorMessage(err));
            } finally {
              setStoppingId(undefined);
            }
          }}
          onCancelStop={() => {
            setConfirmStopId(undefined);
          }}
          onToggleAdvanced={() => setShowAdvanced((value) => !value)}
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
          {isRawModeSupported ? (
            <Box flexDirection="column">
              <Text bold>{formatRow("Status", "Name", "Updated")}</Text>
              <Select
                options={deployments.map((deployment, index) => ({
                  value: String(index),
                  label: formatRow(
                    deployment.status,
                    displayName(deployment),
                    formatRelativeTime(deployment.updatedAt),
                  ),
                }))}
                visibleOptionCount={Math.min(8, deployments.length)}
                defaultValue={String(selectedIndex)}
                onChange={(value) => setSelectedIndex(Number(value))}
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text bold>{formatRow("Status", "Name", "Updated")}</Text>
              {deployments.map((deployment) => (
                <Text key={deployment.id}>
                  {formatRow(
                    deployment.status,
                    displayName(deployment),
                    formatRelativeTime(deployment.updatedAt),
                  )}
                </Text>
              ))}
            </Box>
          )}

          {selected ? (
            <SelectedDeployment
              actionError={actionError}
              confirmDelete={confirmDeleteId === selected.id}
              confirmStop={confirmStopId === selected.id}
              deleting={deletingId === selected.id}
              deployment={selected}
              showAdvanced={showAdvanced}
              starting={startingId === selected.id}
              stopping={stoppingId === selected.id}
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
  confirmDeleteId,
  confirmStopId,
  deployment,
  onExit,
  onRequestDelete,
  onRequestToggle,
  onConfirmDelete,
  onCancelDelete,
  onConfirmStop,
  onCancelStop,
  onToggleAdvanced,
}: {
  confirmDeleteId?: string;
  confirmStopId?: string;
  deployment?: Deployment;
  onExit: () => void;
  onRequestDelete: () => void;
  onRequestToggle: () => void | Promise<void>;
  onConfirmDelete: () => void | Promise<void>;
  onCancelDelete: () => void;
  onConfirmStop: () => void | Promise<void>;
  onCancelStop: () => void;
  onToggleAdvanced: () => void;
}) {
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onExit();
      return;
    }
    if (confirmDeleteId) {
      if (input === "y") {
        void onConfirmDelete();
        return;
      }
      if (input === "n") {
        onCancelDelete();
      }
      return;
    }
    if (confirmStopId) {
      if (input === "y") {
        void onConfirmStop();
        return;
      }
      if (input === "n") {
        onCancelStop();
      }
      return;
    }
    if (input === "a") {
      onToggleAdvanced();
      return;
    }
    if (input === "s") {
      void onRequestToggle();
      return;
    }
    if (input === "d") {
      onRequestDelete();
      return;
    }
    if (input === "o" && deployment?.url && deployment.status === "running") {
      void open(deployment.url);
    }
  });

  return null;
}

function formatRow(
  status: string,
  name: string,
  updated: string,
): string {
  return [
    fit(status, 12),
    fit(name, 24),
    fit(updated, 10),
  ].join("  ");
}

function fit(value: string, width: number): string {
  if (value.length > width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width, " ");
}

function SelectedDeployment({
  actionError,
  confirmDelete,
  confirmStop,
  deleting,
  deployment,
  showAdvanced,
  starting,
  stopping,
}: {
  actionError?: string;
  confirmDelete: boolean;
  confirmStop: boolean;
  deleting: boolean;
  deployment: Deployment;
  showAdvanced: boolean;
  starting: boolean;
  stopping: boolean;
}) {
  const summary = summaryLine(deployment);
  const normalizedSummary = normalizeStatusText(summary);
  const normalizedCurrentStep = normalizeStatusText(deployment.currentStep);
  const showCurrentStep =
    Boolean(deployment.currentStep) && normalizedCurrentStep !== normalizedSummary;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{displayName(deployment)}</Text>
        <Text dimColor>  {deployment.status}</Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Text>{summary}</Text>
        {deployment.url ? (
          <Text color="cyan">{deployment.url}</Text>
        ) : showCurrentStep ? (
          <Text dimColor>{deployment.currentStep}</Text>
        ) : null}
        {deleting ? (
          <Text dimColor>Deleting deployment…</Text>
        ) : null}
        {starting ? (
          <Text dimColor>Starting deployment…</Text>
        ) : null}
        {stopping ? (
          <Text dimColor>Stopping deployment…</Text>
        ) : null}
        {confirmDelete ? (
          <Text color="yellow">Delete this deployment permanently? Press y to confirm or n to cancel.</Text>
        ) : null}
        {confirmStop ? (
          <Text color="yellow">Stop this deployment? Press y to confirm or n to cancel.</Text>
        ) : null}
        {actionError ? (
          <Text color="red">{actionError}</Text>
        ) : null}
      </Box>

      {showAdvanced ? (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text dimColor>id: {shortId(deployment.id)}</Text>
          <Text dimColor>created: {formatRelativeTime(deployment.createdAt)}</Text>
          <Text dimColor>updated: {formatRelativeTime(deployment.updatedAt)}</Text>
          <Text dimColor>source: {deployment.source.type}  {deployment.source.ref}</Text>
          {deployment.runtime ? <Text dimColor>runtime: {deployment.runtime}</Text> : null}
          {deployment.kind === "cli" && deployment.entrypoint?.length ? (
            <Text dimColor>entrypoint: {deployment.entrypoint.join(" ")}</Text>
          ) : null}
          {deployment.kind !== "cli" && deployment.runCommand ? (
            <Text dimColor>start command: {deployment.runCommand}</Text>
          ) : null}
          {deployment.backendUrl && deployment.backendUrl !== deployment.url ? (
            <Text dimColor>backend URL: {deployment.backendUrl}</Text>
          ) : null}
          {deployment.tunnelUrls
            ? Object.entries(deployment.tunnelUrls)
                .filter(([, url]) => url !== deployment.url)
                .slice(0, 3)
                .map(([label, url]) => (
                  <Text key={label} dimColor>
                    {label}: {url}
                  </Text>
                ))
            : null}
        </Box>
      ) : null}
    </Box>
  );
}

function displayName(deployment: Deployment): string {
  const explicitName = deployment.name?.trim();
  if (explicitName && explicitName !== deployment.id) return explicitName;

  return shortId(deployment.id);
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function summaryLine(deployment: Deployment): string {
  switch (deployment.status) {
    case "running":
      return deployment.kind === "cli"
        ? "Ready to use in browser"
        : "Ready to open";
    case "failed":
      return deployment.error ?? "Deployment failed";
    case "stopped":
      return "Stopped";
    default:
      return deployment.currentStep ?? humanizeStatus(deployment.status);
  }
}

function humanizeStatus(status: Deployment["status"]): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "provisioning":
      return "Provisioning sandbox";
    case "analyzing":
      return "Analyzing project";
    case "building":
      return "Installing and building";
    case "exposing":
      return "Preparing public URL";
    case "running":
      return "Live";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

function shouldStart(deployment: Deployment): boolean {
  return deployment.status === "stopped" || deployment.status === "failed";
}

function startStopLabel(deployment: Deployment): string {
  return shouldStart(deployment) ? "start" : "stop";
}

function normalizeStatusText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.{3,}$/g, "")
    .replace(/[\s]+/g, " ");
}
