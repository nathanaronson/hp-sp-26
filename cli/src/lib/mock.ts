import { config } from "./config.js";
import type { AuthMe, Deployment, DeploymentStatus } from "./types.js";

export const MOCK_TOKEN = "mock-token";

export const MOCK_IDENTITY: AuthMe = {
  user: { id: "user_demo", email: "demo@dploy.dev" },
  org: { id: "org_demo", slug: "demo-org" },
};

const FAKE_DEPLOYMENTS: Deployment[] = [
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
    error: "pnpm install failed: ENOENT pnpm-lock.yaml",
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 19).toISOString(),
  },
  {
    id: "dep_ghi789",
    name: "worker",
    status: "starting",
    currentStep: "Running pnpm start",
    source: { type: "github", ref: "acme/worker" },
    runCommand: "pnpm start",
    createdAt: new Date(Date.now() - 1000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export function isMockMode(): boolean {
  return Boolean(config.get("mock")) || process.env.DPLOY_MOCK === "1";
}

export function mockResponse(path: string, method: string): unknown | undefined {
  if (path === "/api/auth/me" && method === "GET") return MOCK_IDENTITY;

  if (path === "/api/deployments" && method === "GET") return FAKE_DEPLOYMENTS;

  const idMatch = path.match(/^\/api\/deployments\/([^/]+)$/);
  if (idMatch) {
    const id = idMatch[1]!;
    const found = FAKE_DEPLOYMENTS.find((d) => d.id === id);
    if (method === "GET") return found ?? simulateProgress(id);
    if (method === "DELETE")
      return { ...(found ?? simulateProgress(id)), status: "stopped" as DeploymentStatus };
  }

  if (path === "/api/auth/logout" && method === "POST") return {};

  return undefined;
}

function simulateProgress(id: string): Deployment {
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
