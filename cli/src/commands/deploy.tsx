import { statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { AppShell } from "../components/AppShell.js";
import { DeploymentSummary } from "../components/DeploymentSummary.js";
import { EnvSummary } from "../components/EnvSummary.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { StepList, type StepItem } from "../components/StepList.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDeploymentPoll } from "../hooks/useDeploymentPoll.js";
import { api, uploadBundle } from "../lib/api.js";
import { bundleDir, type BundleResult } from "../lib/bundle.js";
import { loadEnv } from "../lib/env.js";
import { errorMessage } from "../lib/errors.js";
import { isGithubUrl } from "../lib/github.js";
import type {
  CreateDeploymentBody,
  CreateDeploymentResponse,
  Deployment,
  DeploymentStatus,
  UploadResponse,
} from "../lib/types.js";

type Props = {
  target?: string;
  envInline: string[];
  envFile?: string;
  name?: string;
  follow: boolean;
};

type DeployPhase =
  | "starting"
  | "bundling"
  | "uploading"
  | "creating"
  | "polling"
  | "ready"
  | "failed";

const TERMINAL = new Set<DeploymentStatus>(["ready", "failed", "stopped"]);

export function Deploy({ target, envInline, envFile, name, follow }: Props) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { isAuthed } = useAuth();
  const sourceTarget = target?.trim();
  const isGithub = Boolean(sourceTarget && isGithubUrl(sourceTarget));
  const resolvedPath = resolve(process.cwd(), sourceTarget ?? ".");
  const displayTarget = isGithub ? sourceTarget! : resolvedPath;
  const [phase, setPhase] = useState<DeployPhase>("starting");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [bundle, setBundle] = useState<BundleResult>();
  const [upload, setUpload] = useState<UploadResponse>();
  const [deploymentId, setDeploymentId] = useState<string>();
  const [error, setError] = useState<string>();
  const [lastActiveStatus, setLastActiveStatus] = useState<DeploymentStatus>();

  const pollState = useDeploymentPoll(deploymentId, 1000);
  const deployment = pollState.deployment;

  useEffect(() => {
    let cancelled = false;
    let bundlePath: string | undefined;

    async function run(): Promise<void> {
      try {
        if (!isAuthed) {
          throw new Error("Not logged in. Run `dploy login` first.");
        }

        const cwd = isGithub ? process.cwd() : ensureLocalDirectory(resolvedPath);
        const loadedEnv = loadEnv({
          cwd,
          file: envFile,
          inline: envInline,
        });
        if (cancelled) return;
        setEnv(loadedEnv);

        let source: CreateDeploymentBody["source"];

        if (isGithub) {
          source = { type: "github", url: sourceTarget! };
        } else {
          setPhase("bundling");
          const bundled = await bundleDir(cwd);
          bundlePath = bundled.path;
          if (cancelled) return;
          setBundle(bundled);

          setPhase("uploading");
          const uploaded = await uploadBundle(bundled.path);
          if (cancelled) return;
          setUpload(uploaded);
          source = { type: "upload", id: uploaded.uploadId };
        }

        setPhase("creating");
        const created = await api<CreateDeploymentResponse>("/api/deployments", {
          method: "POST",
          body: { source, env: loadedEnv, name },
        });
        if (cancelled) return;
        setDeploymentId(created.deploymentId);
        setPhase("polling");
      } catch (err) {
        if (cancelled) return;
        process.exitCode = 1;
        setError(errorMessage(err));
        setPhase("failed");
      } finally {
        if (bundlePath) void unlink(bundlePath).catch(() => {});
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [envFile, envInline, exit, isAuthed, isGithub, name, resolvedPath, sourceTarget]);

  useEffect(() => {
    if (!deployment) return;
    if (!TERMINAL.has(deployment.status)) {
      setLastActiveStatus(deployment.status);
    }

    if (deployment.status === "ready") {
      setPhase("ready");
      return;
    }

    if (deployment.status === "failed") {
      process.exitCode = 1;
      setError(deployment.error ?? "Deployment failed.");
      setPhase("failed");
      return;
    }

    if (deployment.status === "stopped") {
      process.exitCode = 1;
      setError("Deployment stopped before it became ready.");
      setPhase("failed");
      return;
    }

    if (deploymentId) setPhase("polling");
  }, [deployment, deploymentId]);

  useEffect(() => {
    if (!pollState.error) return;
    process.exitCode = 1;
    setError(pollState.error);
    setPhase("failed");
  }, [pollState.error]);

  useEffect(() => {
    if (follow) return;
    if (phase !== "ready" && phase !== "failed") return;
    const timeout = setTimeout(() => exit(), phase === "ready" ? 1800 : 2200);
    return () => clearTimeout(timeout);
  }, [exit, follow, phase]);

  const steps = buildSteps({
    bundle,
    deployment,
    isGithub,
    lastActiveStatus,
    phase,
    upload,
  });

  const elapsedSec = deployment
    ? Math.max(
        1,
        Math.round(
          (Date.parse(deployment.updatedAt) - Date.parse(deployment.createdAt)) / 1000,
        ),
      )
    : undefined;
  const isLargeBundle = (bundle?.size ?? 0) > 50 * 1024 * 1024;

  return (
    <AppShell
      command="deploy"
      hints={[
        { keys: "q", label: "quit" },
        ...(follow ? [{ keys: "esc", label: "detach" }] : []),
      ]}
      showElapsed={phase !== "ready" && phase !== "failed"}
    >
      <Box flexDirection="column">
        {isRawModeSupported ? <QuitInput onExit={exit} /> : null}
        <Text>
          Source: <Text color="cyan">{displayTarget}</Text>
        </Text>
        {name ? (
          <Box marginTop={1}>
            <Text>
              Name: <Text color="cyan">{name}</Text>
            </Text>
          </Box>
        ) : null}
        {bundle ? (
          <Box marginTop={1}>
            <Text dimColor>
              Bundle ready: {bundle.fileCount} files, {formatBytes(bundle.size)}
            </Text>
          </Box>
        ) : null}
        {upload ? (
          <Box marginTop={1}>
            <Text dimColor>Upload ID: {upload.uploadId}</Text>
          </Box>
        ) : null}
        {deployment ? (
          <Box marginTop={1}>
            <StatusBadge status={deployment.status} />
            <Text dimColor>  {deployment.id}</Text>
          </Box>
        ) : deploymentId ? (
          <Box marginTop={1}>
            <Text dimColor>Deployment ID: {deploymentId}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <EnvSummary env={env} />
        </Box>
        {isLargeBundle ? (
          <Box marginTop={1}>
            <Text color="yellow">
              Large bundle warning: uploads over 50 MB may take noticeably longer.
            </Text>
          </Box>
        ) : null}

        {error ? (
          <Box flexDirection="column" marginTop={1}>
            <StepList steps={steps} />
            <Box marginTop={1}>
              <ErrorPanel
                message={error}
                hint="Use `dploy login --mock` for a local demo or try again once the API is reachable."
              />
            </Box>
          </Box>
        ) : phase === "ready" && deployment ? (
          <DeploymentSummary deployment={deployment} elapsedSec={elapsedSec} />
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <StepList steps={steps} />
          </Box>
        )}
      </Box>
    </AppShell>
  );
}

function QuitInput({ onExit }: { onExit: () => void }) {
  useInput((input, key) => {
    if (input === "q" || key.escape) onExit();
  });

  return null;
}

function ensureLocalDirectory(path: string): string {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new Error(`Path not found: ${path}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Expected a directory to deploy: ${path}`);
  }

  return path;
}

function buildSteps({
  phase,
  isGithub,
  bundle,
  upload,
  deployment,
  lastActiveStatus,
}: {
  phase: DeployPhase;
  isGithub: boolean;
  bundle?: BundleResult;
  upload?: UploadResponse;
  deployment?: Deployment;
  lastActiveStatus?: DeploymentStatus;
}): StepItem[] {
  const steps: StepItem[] = [];

  if (!isGithub) {
    steps.push({
      key: "bundle",
      label: "Bundle project",
      state: getBundleState(phase, bundle),
      details: bundle
        ? [`${bundle.fileCount} files included`, `${formatBytes(bundle.size)} archive`]
        : phase === "bundling"
          ? ["Reading .gitignore and packaging files"]
          : undefined,
    });

    steps.push({
      key: "upload",
      label: "Upload bundle",
      state: getUploadState(phase, upload),
      details: upload
        ? [`Upload ID ${upload.uploadId}`]
        : phase === "uploading"
          ? [bundle ? `Sending ${formatBytes(bundle.size)}` : "Streaming tarball"]
          : undefined,
    });
  }

  const remoteSteps = [
    { key: "provisioning", label: "Provision sandbox" },
    ...(isGithub ? [{ key: "cloning", label: "Clone repo" }] : []),
    { key: "analyzing", label: "Analyze project" },
    { key: "installing", label: "Install dependencies" },
    { key: "starting", label: "Start server" },
    { key: "exposing", label: "Expose port" },
  ] as const;

  const activeKey =
    deployment?.status && !TERMINAL.has(deployment.status)
      ? deployment.status
      : phase === "creating" || phase === "polling"
        ? "provisioning"
        : undefined;
  const failureKey = inferFailureKey(deployment, lastActiveStatus);
  const activeIndex = remoteSteps.findIndex((step) => step.key === activeKey);
  const failureIndex = remoteSteps.findIndex((step) => step.key === failureKey);
  const doneAllRemote = deployment?.status === "ready";

  remoteSteps.forEach((step, index) => {
    let state: StepItem["state"] = "pending";
    if (doneAllRemote) {
      state = "done";
    } else if (failureIndex >= 0) {
      if (index < failureIndex) state = "done";
      if (index === failureIndex) state = "failed";
    } else if (activeIndex >= 0) {
      if (index < activeIndex) state = "done";
      if (index === activeIndex) state = "running";
    }

    steps.push({
      key: step.key,
      label: step.label,
      state,
      details:
        state === "running"
          ? [deployment?.currentStep ?? fallbackRemoteDetail(step.key)]
          : state === "failed" && deployment?.error
            ? [deployment.error]
            : undefined,
    });
  });

  return steps;
}

function getBundleState(
  phase: DeployPhase,
  bundle: BundleResult | undefined,
): StepItem["state"] {
  if (bundle) return "done";
  if (phase === "bundling") return "running";
  return "pending";
}

function getUploadState(
  phase: DeployPhase,
  upload: UploadResponse | undefined,
): StepItem["state"] {
  if (upload) return "done";
  if (phase === "uploading") return "running";
  return "pending";
}

function inferFailureKey(
  deployment: Deployment | undefined,
  lastActiveStatus: DeploymentStatus | undefined,
): DeploymentStatus | undefined {
  if (deployment?.status !== "failed") return undefined;
  if (lastActiveStatus && !TERMINAL.has(lastActiveStatus)) return lastActiveStatus;

  const step = deployment.currentStep?.toLowerCase() ?? "";
  if (step.includes("clone")) return "cloning";
  if (step.includes("install")) return "installing";
  if (step.includes("start")) return "starting";
  if (step.includes("expos")) return "exposing";
  if (step.includes("analy")) return "analyzing";
  return "provisioning";
}

function fallbackRemoteDetail(status: string): string {
  switch (status) {
    case "provisioning":
      return "Allocating sandbox";
    case "cloning":
      return "Cloning repository";
    case "analyzing":
      return "Inspecting project files";
    case "installing":
      return "Installing dependencies";
    case "starting":
      return "Launching application";
    case "exposing":
      return "Assigning public URL";
    default:
      return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
