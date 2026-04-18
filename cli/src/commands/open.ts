import open from "open";
import { api } from "../lib/api.js";
import type { Deployment } from "../lib/types.js";

export async function openCmd(id: string): Promise<void> {
  const dep = await api<Deployment>(`/api/deployments/${id}`);
  if (!dep.url) {
    console.error(`Deployment ${id} has no URL yet (status: ${dep.status})`);
    process.exit(1);
  }
  await open(dep.url);
}
