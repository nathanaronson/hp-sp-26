export type DeploymentStatus =
  | "pending"
  | "provisioning"
  | "analyzing"
  | "building"
  | "exposing"
  | "running"
  | "failed"
  | "stopped";

export type DeploymentSource =
  | { type: "upload"; ref: string }
  | { type: "github"; ref: string };

export type DeploymentKind = "web" | "cli";

export type Deployment = {
  id: string;
  name: string;
  status: DeploymentStatus;
  kind?: DeploymentKind;
  currentStep?: string;
  source: DeploymentSource;
  runtime?: string;
  packageManager?: string;
  installCommands?: string[];
  buildCommands?: string[];
  runCommand?: string;
  startCommand?: string;
  startCommands?: { label?: string; command?: string; port_hint?: number | null }[];
  entrypoint?: string[];
  envRequired?: string[];
  port?: number;
  boundAddress?: string;
  healthPath?: string;
  httpStatus?: number;
  ports?: { internal: number; public: string }[];
  url?: string;
  backendUrl?: string;
  tunnelUrls?: Record<string, string>;
  logs?: string[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type CreateDeploymentBody = {
  source:
    | { type: "upload"; id: string }
    | { type: "github"; url: string };
  env?: Record<string, string>;
  name?: string;
  model?: string;
};

export type UploadResponse = {
  uploadId: string;
  size: number;
};

export type CreateDeploymentResponse = {
  deploymentId: string;
};

export type AuthMe = {
  user: { id: string; email: string };
  org: { id: string; slug: string };
};
