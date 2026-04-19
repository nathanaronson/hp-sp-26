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
  sandbox_id?: string | null;
  model?: string | null;
  kind?: string | null;
  entrypoint?: string[] | null;
  runtime?: string | null;
  package_manager?: string | null;
  install_commands?: string[] | null;
  build_commands?: string[] | null;
  start_command?: string | null;
  start_commands?: Array<{ label?: string; command?: string; port_hint?: number | null }> | null;
  run_commands: string[] | null;
  env_required: string[] | null;
  port?: number | null;
  bound_address?: string | null;
  health_path?: string | null;
  http_status?: number | null;
  exposed_ports: number[] | null;
  public_url: string | null;
  backend_url?: string | null;
  tunnel_urls?: Record<string, string> | null;
  logs?: string | null;
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
  provisioning: "provisioning",
  building: "building",
  exposing: "exposing",
  running: "running",
  failed: "failed",
  stopped: "stopped",
};

export function adaptDeployment(d: BackendDeployment): Deployment {
  const status = STATUS_MAP[d.status] ?? "pending";
  const urls = uniqueUrls(d);
  const ports = d.exposed_ports?.map((p, index) => ({
    internal: p,
    public: urls[index] ?? urls[0] ?? `:${p}`,
  }));

  const kind = d.kind === "cli" ? "cli" : d.kind === "web" ? "web" : undefined;
  return {
    id: d.id,
    name: d.name ?? d.id,
    status,
    kind,
    currentStep: inferCurrentStep(d),
    source: d.github_url
      ? { type: "github", ref: stripGithubPrefix(d.github_url) }
      : { type: "upload", ref: d.upload_id ?? "?" },
    runtime: d.runtime ?? undefined,
    packageManager: d.package_manager ?? undefined,
    installCommands: d.install_commands ?? undefined,
    buildCommands: d.build_commands ?? undefined,
    runCommand: formatRunCommand(d),
    startCommand: d.start_command ?? undefined,
    startCommands: d.start_commands ?? undefined,
    entrypoint: d.entrypoint ?? undefined,
    envRequired: d.env_required ?? undefined,
    port: d.port ?? undefined,
    boundAddress: d.bound_address ?? undefined,
    healthPath: d.health_path ?? undefined,
    httpStatus: d.http_status ?? undefined,
    ports,
    url: d.public_url ?? d.backend_url ?? urls[0],
    backendUrl: d.backend_url ?? undefined,
    tunnelUrls: d.tunnel_urls ?? undefined,
    logs: splitLogs(d.logs),
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
): { github_url?: string; upload_id?: string; name?: string; model?: string } {
  if (body.source.type === "github") {
    return { github_url: body.source.url, name: body.name, model: body.model };
  }
  return { upload_id: body.source.id, name: body.name, model: body.model };
}

function stripGithubPrefix(url: string): string {
  return url
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
}

function splitLogs(logs: string | null | undefined): string[] | undefined {
  if (!logs) return undefined;
  const lines = logs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function inferCurrentStep(d: BackendDeployment): string | undefined {
  const lines = splitLogs(d.logs);
  const latest = lines?.[lines.length - 1];
  if (!latest) return undefined;
  return latest.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
}

function formatRunCommand(d: BackendDeployment): string | undefined {
  const startCommands = d.start_commands
    ?.map((service) => {
      if (!service.command) return undefined;
      return service.label ? `${service.label}: ${service.command}` : service.command;
    })
    .filter((service): service is string => Boolean(service));
  if (startCommands && startCommands.length > 0) {
    return startCommands.join(" | ");
  }
  if (d.start_command) return d.start_command;
  if (d.run_commands && d.run_commands.length > 0) return d.run_commands.join(" && ");
  return undefined;
}

function uniqueUrls(d: BackendDeployment): string[] {
  const seen = new Set<string>();
  const urls = [
    d.public_url,
    d.backend_url,
    ...(d.tunnel_urls ? Object.values(d.tunnel_urls) : []),
  ].filter((url): url is string => Boolean(url));

  return urls.filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}
