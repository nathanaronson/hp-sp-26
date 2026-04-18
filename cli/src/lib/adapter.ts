import type {
  AuthMe,
  CreateDeploymentBody,
  Deployment,
  DeploymentStatus,
  UploadResponse,
} from "./types.js";

// Shape returned by the backend (subset of fields we use).
export type BackendUser = {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type BackendDeployment = {
  id: string;
  name: string | null;
  github_url: string | null;
  upload_id: string | null;
  status: string;
  run_commands: string[] | null;
  env_required: string[] | null;
  exposed_ports: number[] | null;
  public_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendDeploymentList = {
  items: BackendDeployment[];
  total: number;
};

export type BackendUploadResponse = {
  upload_id: string;
  filename: string;
  size: number;
};

const STATUS_MAP: Record<string, DeploymentStatus> = {
  pending: "pending",
  analyzing: "analyzing",
  building: "installing",
  running: "ready",
  failed: "failed",
  stopped: "stopped",
};

export function adaptDeployment(d: BackendDeployment): Deployment {
  const status = STATUS_MAP[d.status] ?? "pending";
  const ports = d.exposed_ports?.map((p) => ({
    internal: p,
    public: d.public_url ?? `:${p}`,
  }));

  return {
    id: d.id,
    name: d.name ?? d.id,
    status,
    source: d.github_url
      ? { type: "github", ref: stripGithubPrefix(d.github_url) }
      : { type: "upload", ref: d.upload_id ?? "?" },
    runCommand: d.run_commands?.join(" && "),
    ports,
    url: d.public_url ?? undefined,
    error: d.error ?? undefined,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

export function adaptUser(u: BackendUser): AuthMe {
  return {
    user: { id: u.id, email: u.email ?? `${u.login}@github` },
    org: { id: u.id, slug: u.login },
  };
}

export function adaptUpload(u: BackendUploadResponse): UploadResponse {
  return { uploadId: u.upload_id, size: u.size };
}

export function toBackendDeploymentCreate(
  body: CreateDeploymentBody,
): { github_url?: string; upload_id?: string; name?: string } {
  if (body.source.type === "github") {
    return { github_url: body.source.url, name: body.name };
  }
  return { upload_id: body.source.id, name: body.name };
}

function stripGithubPrefix(url: string): string {
  return url
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
}
