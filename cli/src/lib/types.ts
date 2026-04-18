export type DeploymentStatus =
  | "pending"
  | "uploading"
  | "provisioning"
  | "cloning"
  | "analyzing"
  | "installing"
  | "starting"
  | "exposing"
  | "ready"
  | "failed"
  | "stopped";

export type DeploymentSource =
  | { type: "upload"; ref: string }
  | { type: "github"; ref: string };

export type Deployment = {
  id: string;
  name: string;
  status: DeploymentStatus;
  currentStep?: string;
  source: DeploymentSource;
  runCommand?: string;
  ports?: { internal: number; public: string }[];
  url?: string;
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
};

export type AuthMe = {
  user: { id: string; email: string };
  org: { id: string; slug: string };
};
