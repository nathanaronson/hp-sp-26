import { statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import open from "open";
import { AppShell } from "../components/AppShell.js";
import { DeploymentSummary } from "../components/DeploymentSummary.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { StepList, type StepItem } from "../components/StepList.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDeploymentPoll } from "../hooks/useDeploymentPoll.js";
import { api, uploadBundle } from "../lib/api.js";
import { bundleDir, type BundleResult } from "../lib/bundle.js";
import { loadEnv } from "../lib/env.js";
import { errorMessage } from "../lib/errors.js";
import {
  detectGithubUrlFromGit,
  isGithubUrl,
  normalizeGithubUrl,
} from "../lib/github.js";
import { isMockMode } from "../lib/mock.js";
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
  | "resolving_source"
  | "bundling"
  | "uploading"
  | "creating"
  | "polling"
  | "running"
  | "failed";

const TERMINAL = new Set<DeploymentStatus>(["running", "failed", "stopped"]);

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
  const [resolvedGithubUrl, setResolvedGithubUrl] = useState<string>();
  const [openedUrl, setOpenedUrl] = useState<string>();

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
          const githubUrl = normalizeGithubUrl(sourceTarget!);
          setResolvedGithubUrl(githubUrl);
          source = { type: "github", url: githubUrl };
        } else {
          setPhase("resolving_source");
          const githubUrl = await detectGithubUrlFromGit(cwd);
          if (githubUrl) {
            if (cancelled) return;
            setResolvedGithubUrl(githubUrl);
            source = { type: "github", url: githubUrl };
          } else if (isMockMode()) {
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
          } else {
            throw new Error(
              "Local deploys now follow the GitHub path. No GitHub remote was found for this directory, so use `dploy deploy <github-url>` or add a GitHub remote first.",
            );
          }
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

    if (deployment.status === "running") {
      setPhase("running");
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
      setError("Deployment stopped before it became live.");
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
    if (!follow || !deployment?.url || deployment.status !== "running") return;
    if (openedUrl === deployment.url) return;

    let cancelled = false;
    void (async () => {
      try {
        await open(deployment.url!);
        if (!cancelled) setOpenedUrl(deployment.url);
      } catch (err) {
        if (!cancelled) {
          process.exitCode = 1;
          setError(errorMessage(err));
          setPhase("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deployment, follow, openedUrl]);

  useEffect(() => {
    if (follow) return;
    if (phase !== "running" && phase !== "failed") return;
    const timeout = setTimeout(() => exit(), phase === "running" ? 1800 : 2200);
    return () => clearTimeout(timeout);
  }, [exit, follow, phase]);

  useEffect(() => {
    if (!follow) return;
    if (phase !== "running" || !openedUrl) return;
    const timeout = setTimeout(() => exit(), 1200);
    return () => clearTimeout(timeout);
  }, [exit, follow, openedUrl, phase]);

  const steps = buildSteps({
    bundle,
    deployment,
    isGithub,
    lastActiveStatus,
    phase,
    resolvedGithubUrl,
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
  const deployName = name ?? deployment?.name;

  return (
    <AppShell
      command="deploy"
      hints={[
        { keys: "q", label: "quit" },
        ...(deployment?.status === "running" && deployment.url
          ? [{ keys: "o", label: "open" }]
          : []),
      ]}
      showElapsed={phase !== "running" && phase !== "failed"}
    >
      <Box flexDirection="column">
        {isRawModeSupported ? (
          <QuitInput deployment={deployment} onExit={exit} />
        ) : null}
        <Text>
          Source: <Text color="cyan">{resolvedGithubUrl ?? displayTarget}</Text>
        </Text>
        {!isGithub && resolvedGithubUrl ? (
          <Box>
            <Text dimColor>
              Resolved from local checkout {resolvedPath}. Uncommitted local changes are not included.
            </Text>
          </Box>
        ) : null}
        {deployName ? (
          <Box>
            <Text>
              Name: <Text color="cyan">{deployName}</Text>
            </Text>
          </Box>
        ) : null}
        {deployment ? (
          <Box>
            <StatusBadge status={deployment.status} />
            <Text dimColor>  {deployment.id}</Text>
          </Box>
        ) : deploymentId ? (
          <Box>
            <Text dimColor>Deployment ID: {deploymentId}</Text>
          </Box>
        ) : null}
        {isLargeBundle ? (
          <Box>
            <Text color="yellow">
              Large bundle warning: uploads over 50 MB may take noticeably longer.
            </Text>
          </Box>
        ) : null}

        {!isAuthed && !error && !bundle && !upload && !deploymentId && !deployment ? (
          <Box>
            <Text dimColor>Checking auth…</Text>
          </Box>
        ) : error && !bundle && !upload && !deploymentId && !deployment ? (
          <ErrorPanel
            message={error}
            hint="Use `dploy login --mock` for a local demo or try again once the API is reachable."
          />
        ) : error ? (
          <Box flexDirection="column">
            <StepList steps={steps} />
            <Box>
              <ErrorPanel
                message={error}
                hint="Use `dploy login --mock` for a local demo or try again once the API is reachable."
              />
            </Box>
          </Box>
        ) : phase === "running" && deployment ? (
          <Box flexDirection="column">
            {follow && openedUrl ? (
              <Box>
                <Text dimColor>Opened </Text>
                <Text color="cyan">{openedUrl}</Text>
              </Box>
            ) : null}
            <DeploymentSummary
              deployment={deployment}
              elapsedSec={elapsedSec}
            />
          </Box>
        ) : (
          <Box flexDirection="column">
            {deployment ? (
              <Box flexDirection="column" marginBottom={1}>
                <Text>
                  Current: <Text color="cyan">{deployment.currentStep ?? humanizeStatus(deployment.status)}</Text>
                </Text>
                {deployment.url ? (
                  <Text dimColor>{deployment.url}</Text>
                ) : null}
              </Box>
            ) : null}
            <StepList steps={stripStepDetails(steps)} />
          </Box>
        )}
      </Box>
    </AppShell>
  );
}

function QuitInput({
  deployment,
  onExit,
}: {
  deployment?: Deployment;
  onExit: () => void;
}) {
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onExit();
      return;
    }
    if (input === "o" && deployment?.status === "running" && deployment.url) {
      void open(deployment.url);
    }
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
  resolvedGithubUrl,
}: {
  phase: DeployPhase;
  isGithub: boolean;
  bundle?: BundleResult;
  upload?: UploadResponse;
  deployment?: Deployment;
  lastActiveStatus?: DeploymentStatus;
  resolvedGithubUrl?: string;
}): StepItem[] {
  const steps: StepItem[] = [];

  if (!isGithub) {
    steps.push({
      key: "resolve-source",
      label: "Resolve GitHub source",
      state: getResolveSourceState(phase, resolvedGithubUrl, bundle, upload),
      details: resolvedGithubUrl
        ? [resolvedGithubUrl, "Deploying the remote repo, not local uncommitted changes"]
        : phase === "resolving_source"
          ? ["Inspecting git remotes"]
          : undefined,
    });
  }

  if (!isGithub && !resolvedGithubUrl) {
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
    {
      key: "provisioning",
      label:
        isGithub || resolvedGithubUrl ? "Provision sandbox + clone repo" : "Provision sandbox",
    },
    { key: "analyzing", label: "Analyze project" },
    {
      key: "building",
      label: deployment?.kind === "cli" ? "Install/build CLI" : "Install/build services",
    },
    {
      key: "exposing",
      label: deployment?.kind === "cli" ? "Start browser terminal" : "Expose service",
    },
  ] as const;

  const activeKey = inferActiveKey(deployment?.status, phase);
  const failureKey = inferFailureKey(deployment, lastActiveStatus);
  const activeIndex = remoteSteps.findIndex((step) => step.key === activeKey);
  const failureIndex = remoteSteps.findIndex((step) => step.key === failureKey);
  const doneAllRemote = deployment?.status === "running";

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

function getResolveSourceState(
  phase: DeployPhase,
  resolvedGithubUrl: string | undefined,
  bundle: BundleResult | undefined,
  upload: UploadResponse | undefined,
): StepItem["state"] {
  if (resolvedGithubUrl || bundle || upload) return "done";
  if (phase === "resolving_source") return "running";
  return "pending";
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

function inferActiveKey(
  status: DeploymentStatus | undefined,
  phase: DeployPhase,
): "provisioning" | "analyzing" | "building" | "exposing" | undefined {
  if (!status) {
    return phase === "creating" || phase === "polling" ? "provisioning" : undefined;
  }
  if (status === "pending" || status === "provisioning") return "provisioning";
  if (status === "analyzing") return "analyzing";
  if (status === "building") return "building";
  if (status === "exposing") return "exposing";
  return undefined;
}

function inferFailureKey(
  deployment: Deployment | undefined,
  lastActiveStatus: DeploymentStatus | undefined,
): "provisioning" | "analyzing" | "building" | "exposing" | undefined {
  if (deployment?.status !== "failed") return undefined;
  if (lastActiveStatus === "provisioning") return "provisioning";
  if (lastActiveStatus === "analyzing") return "analyzing";
  if (lastActiveStatus === "building") return "building";
  if (lastActiveStatus === "exposing") return "exposing";

  const step = deployment.currentStep?.toLowerCase() ?? "";
  if (step.includes("analy")) return "analyzing";
  if (step.includes("install") || step.includes("build")) return "building";
  if (step.includes("start") || step.includes("ttyd") || step.includes("tunnel") || step.includes("expos")) {
    return "exposing";
  }
  if (step.includes("clone") || step.includes("sandbox")) return "provisioning";
  return "provisioning";
}

function fallbackRemoteDetail(status: string): string {
  switch (status) {
    case "provisioning":
      return "Provisioning sandbox and cloning repository";
    case "analyzing":
      return "Inspecting project files";
    case "building":
      return "Running install and build commands";
    case "exposing":
      return "Bringing up a public URL";
    default:
      return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripStepDetails(steps: StepItem[]): StepItem[] {
  return steps.map((step) => ({
    ...step,
    details:
      step.state === "failed" || step.state === "running"
        ? step.details?.slice(0, 1)
        : undefined,
  }));
}

function humanizeStatus(status: DeploymentStatus): string {
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
      return "Bringing up public URL";
    case "running":
      return "Live";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}
