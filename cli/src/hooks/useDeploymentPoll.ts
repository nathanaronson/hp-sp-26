import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { Deployment, DeploymentStatus } from "../lib/types.js";

type Phase = "polling" | "ready" | "failed" | "stopped";

type PollState = {
  deployment?: Deployment;
  phase: Phase;
  error?: string;
};

const TERMINAL: DeploymentStatus[] = ["ready", "failed", "stopped"];

export function useDeploymentPoll(id: string | undefined, intervalMs = 1000): PollState {
  const [state, setState] = useState<PollState>({ phase: "polling" });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function tick() {
      try {
        const dep = await api<Deployment>(`/api/deployments/${id}`);
        if (cancelled) return;
        const phase: Phase = TERMINAL.includes(dep.status)
          ? (dep.status as Phase)
          : "polling";
        setState({ deployment: dep, phase });
        if (phase !== "polling") clearInterval(timer);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : String(err);
        setState((s) => ({ ...s, error: msg }));
      }
    }

    void tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, intervalMs]);

  return state;
}
