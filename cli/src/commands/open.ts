import open from "open";
import { api } from "../lib/api.js";
import type { Deployment } from "../lib/types.js";

export async function openCmd(id: string): Promise<void> {
  const dep = await api<Deployment>(`/api/deployments/${id}`);
  if (dep.status !== "running") {
    console.error(`Deployment ${id} is not running (status: ${dep.status})`);
    process.exit(1);
  }
  if (!dep.url) {
    console.error(`Deployment ${id} has no URL yet`);
    process.exit(1);
  }
  await open(dep.url);
}
