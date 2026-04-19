import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import type {
  AuthMe,
  CreateDeploymentBody,
  CreateDeploymentResponse,
  Deployment,
  DeploymentStatus,
  UploadResponse,
} from "./types.js";

export const MOCK_TOKEN = "mock-token";

export const MOCK_IDENTITY: AuthMe = {
  user: { id: "user_demo", email: "demo@dploy.dev" },
  org: { id: "org_demo", slug: "demo-org" },
};

type MockUpload = {
  id: string;
  filename: string;
  size: number;
  createdAt: number;
};

type MockDeploymentState = {
  id: string;
  name: string;
  source: Deployment["source"];
  createdAt: number;
  shouldFail: boolean;
  stoppedAt?: number;
};

type StepSpec = {
  status: DeploymentStatus;
  label: string;
  detail: string;
  durationMs: number;
};

const SEEDED_DEPLOYMENTS: Deployment[] = [
  {
    id: "dep_abc123",
    name: "marketing-site",
    status: "ready",
    source: { type: "github", ref: "acme/marketing-site" },
    runCommand: "pnpm install && pnpm dev",
    ports: [{ internal: 3000, public: "https://abc123.dploy.dev" }],
    url: "https://abc123.dploy.dev",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2 + 47_000).toISOString(),
  },
  {
    id: "dep_def456",
    name: "api-staging",
    status: "failed",
    source: { type: "upload", ref: "upl_xyz" },
    currentStep: "Install dependencies",
    error: "pnpm install failed: ENOENT pnpm-lock.yaml",
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 19).toISOString(),
  },
  {
    id: "dep_ghi789",
    name: "worker",
    status: "starting",
    currentStep: "Launching pnpm start",
    source: { type: "github", ref: "acme/worker" },
    runCommand: "pnpm start",
    createdAt: new Date(Date.now() - 1000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockUploads = new Map<string, MockUpload>();
const mockDeployments = new Map<string, MockDeploymentState>();

export function isMockMode(): boolean {
  return Boolean(config.get("mock")) || process.env.dploy_MOCK === "1";
}

export function mockResponse(
  path: string,
  method: string,
  body?: unknown,
): unknown | undefined {
  if (path === "/api/auth/me" && method === "GET") return MOCK_IDENTITY;

  if (path === "/api/auth/logout" && method === "POST") return {};

  if (path === "/api/upload" && method === "POST") {
    const payload = body as { filename?: string; size?: number } | undefined;
    return createMockUpload(payload);
  }

  if (path === "/api/deployments" && method === "GET") {
    return [...listRuntimeDeployments(), ...SEEDED_DEPLOYMENTS].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }

  if (path === "/api/deployments" && method === "POST") {
    return createMockDeployment(body as CreateDeploymentBody);
  }

  const idMatch = path.match(/^\/api\/deployments\/([^/]+)$/);
  if (idMatch) {
    const id = idMatch[1]!;
    if (method === "GET") return getMockDeployment(id);
    if (method === "DELETE") return stopMockDeployment(id);
  }

  return undefined;
}

function createMockUpload(
  payload: { filename?: string; size?: number } | undefined,
): UploadResponse {
  const uploadId = `upl_${randomId()}`;
  mockUploads.set(uploadId, {
    id: uploadId,
    filename: payload?.filename ?? "bundle.tar.gz",
    size: payload?.size ?? 0,
    createdAt: Date.now(),
  });

  return { uploadId, size: payload?.size ?? 0 };
}

function createMockDeployment(body: CreateDeploymentBody): CreateDeploymentResponse {
  if (!body?.source) {
    throw new Error("Mock deployment requires a source.");
  }

  if (body.source.type === "upload" && !mockUploads.has(body.source.id)) {
    throw new Error(`Unknown mock upload ID: ${body.source.id}`);
  }

  const deploymentId = `dep_${randomId()}`;
  const ref =
    body.source.type === "upload" ? body.source.id : sanitizeGithubRef(body.source.url);
  const name =
    body.name ??
    (body.source.type === "github"
      ? body.source.url.split("/").pop()?.replace(/\.git$/i, "") ?? deploymentId
      : `upload-${deploymentId.slice(-4)}`);

  mockDeployments.set(deploymentId, {
    id: deploymentId,
    name,
    source: { type: body.source.type, ref },
    createdAt: Date.now(),
    shouldFail:
      Boolean(body.env?.dploy_FAIL === "1") || /fail/i.test(body.name ?? ""),
  });

  return { deploymentId };
}

function listRuntimeDeployments(): Deployment[] {
  return [...mockDeployments.values()].map((deployment) =>
    materializeDeployment(deployment),
  );
}

function getMockDeployment(id: string): Deployment {
  const runtime = mockDeployments.get(id);
  if (runtime) return materializeDeployment(runtime);

  const seeded = SEEDED_DEPLOYMENTS.find((deployment) => deployment.id === id);
  if (seeded) return seeded;

  return {
    id,
    name: id,
    status: "analyzing",
    currentStep: "Reading package.json",
    source: { type: "upload", ref: "upl_mock" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function stopMockDeployment(id: string): Deployment {
  const runtime = mockDeployments.get(id);
  if (runtime) {
    runtime.stoppedAt = Date.now();
    return materializeDeployment(runtime);
  }

  const seeded = SEEDED_DEPLOYMENTS.find((deployment) => deployment.id === id);
  if (seeded) {
    return {
      ...seeded,
      status: "stopped",
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    id,
    name: id,
    status: "stopped",
    source: { type: "upload", ref: "upl_mock" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function materializeDeployment(state: MockDeploymentState): Deployment {
  const steps = buildSequence(state.source.type === "github");
  const createdAtIso = new Date(state.createdAt).toISOString();

  if (state.stoppedAt) {
    return {
      id: state.id,
      name: state.name,
      status: "stopped",
      source: state.source,
      createdAt: createdAtIso,
      updatedAt: new Date(state.stoppedAt).toISOString(),
    };
  }

  const elapsedMs = Date.now() - state.createdAt;
  const failIndex = steps.findIndex((step) => step.status === "installing");
  const failAtMs =
    failIndex >= 0
      ? steps.slice(0, failIndex + 1).reduce((sum, step) => sum + step.durationMs, 0)
      : Number.POSITIVE_INFINITY;

  if (state.shouldFail && elapsedMs >= failAtMs) {
    return {
      id: state.id,
      name: state.name,
      status: "failed",
      currentStep: "Install dependencies",
      source: state.source,
      createdAt: createdAtIso,
      updatedAt: new Date(state.createdAt + failAtMs).toISOString(),
      error: "pnpm install failed: lockfile is out of date",
    };
  }

  let cumulativeMs = 0;
  for (const step of steps) {
    cumulativeMs += step.durationMs;
    if (elapsedMs < cumulativeMs) {
      return {
        id: state.id,
        name: state.name,
        status: step.status,
        currentStep: step.detail,
        source: state.source,
        createdAt: createdAtIso,
        updatedAt: new Date(Date.now()).toISOString(),
      };
    }
  }

  const readyAtMs = state.createdAt + cumulativeMs;
  const host = `${state.id.slice(-6)}.dploy.dev`;

  return {
    id: state.id,
    name: state.name,
    status: "ready",
    source: state.source,
    runCommand:
      state.source.type === "github" ? "pnpm install && pnpm dev" : "npm install && npm run start",
    ports: [{ internal: 3000, public: `https://${host}` }],
    url: `https://${host}`,
    createdAt: createdAtIso,
    updatedAt: new Date(readyAtMs).toISOString(),
  };
}

function buildSequence(isGithub: boolean): StepSpec[] {
  return [
    {
      status: "provisioning",
      label: "Provision sandbox",
      detail: "Allocating a fresh sandbox",
      durationMs: 900,
    },
    ...(isGithub
      ? [
          {
            status: "cloning" as const,
            label: "Clone repo",
            detail: "Cloning repository",
            durationMs: 1100,
          },
        ]
      : []),
    {
      status: "analyzing",
      label: "Analyze project",
      detail: "Reading package manifests",
      durationMs: 1200,
    },
    {
      status: "installing",
      label: "Install dependencies",
      detail: "Running install command",
      durationMs: 1500,
    },
    {
      status: "starting",
      label: "Start server",
      detail: "Launching detected start command",
      durationMs: 1100,
    },
    {
      status: "exposing",
      label: "Expose port",
      detail: "Configuring public URL",
      durationMs: 900,
    },
  ];
}

function sanitizeGithubRef(url: string): string {
  return url
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
}

function randomId(): string {
  return randomBytes(3).toString("hex");
}
