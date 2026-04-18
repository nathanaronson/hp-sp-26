import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import "./client"; // side-effect: sets baseUrl + credentials on the generated client

import {
  createDeploymentApiV1DeploymentsPostMutation,
  getDeploymentApiV1DeploymentsDeploymentIdGetOptions,
  listDeploymentsApiV1DeploymentsGetOptions,
  logoutApiV1AuthLogoutPostMutation,
  meApiV1AuthMeGetOptions,
} from "../client/@tanstack/react-query.gen";
import type { DeploymentRead, UserRead } from "../client/types.gen";
import { API_BASE_URL } from "./client";

// ---------- Re-exported types ----------

/** Backend deployment status. Matches `app/models/deployment.py`. */
export type DeployStatus =
  | "pending"
  | "analyzing"
  | "building"
  | "running"
  | "failed"
  | "stopped";

export type Project = DeploymentRead;
export type User = UserRead;

// ---------- Auth ----------

/** Redirect to the backend, which 307s to GitHub. */
export function loginWithGithub(): void {
  window.location.href = `${API_BASE_URL}/api/v1/auth/github/login`;
}

export function useUser() {
  return useQuery({
    ...meApiV1AuthMeGetOptions(),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    ...logoutApiV1AuthLogoutPostMutation(),
    onSuccess: () => {
      qc.clear();
    },
  });
}

// ---------- Deployments ----------

export function useProjects() {
  return useQuery(listDeploymentsApiV1DeploymentsGetOptions());
}

export function useProject(id: string | undefined, opts?: { poll?: boolean }) {
  return useQuery({
    ...getDeploymentApiV1DeploymentsDeploymentIdGetOptions({
      path: { deployment_id: id ?? "" },
    }),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      if (!opts?.poll) return false;
      const status = (query.state.data as DeploymentRead | undefined)?.status;
      return status && (status === "running" || status === "failed" || status === "stopped")
        ? false
        : 3_000;
    },
  });
}

export function useDeploy() {
  const qc = useQueryClient();
  return useMutation({
    ...createDeploymentApiV1DeploymentsPostMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listDeploymentsApiV1DeploymentsGetOptions().queryKey });
    },
  });
}

// ---------- UI display helpers ----------

export type DisplayStatus = "Running" | "Building" | "Failed";

/** Collapse the backend's 6 statuses into the 3 the UI cares about. */
export function displayStatus(status: string | undefined | null): DisplayStatus {
  switch (status) {
    case "running":
      return "Running";
    case "failed":
    case "stopped":
      return "Failed";
    default:
      return "Building";
  }
}

/** Human-readable source line for a deployment ("github" or "local"). */
export function deploymentSource(d: DeploymentRead): { type: "github" | "local"; label: string } {
  if (d.github_url) return { type: "github", label: d.github_url };
  return { type: "local", label: "Local upload" };
}

/** Backend stores logs as a single text blob; split into lines for the UI.
 * `logs` is on the SQL model but isn't always in the OpenAPI schema, so we
 * read it defensively. */
export function deploymentLogLines(d: DeploymentRead): string[] {
  const logs = (d as DeploymentRead & { logs?: string | null }).logs;
  if (!logs) return [];
  return logs.split("\n").filter((l: string) => l.length > 0);
}
