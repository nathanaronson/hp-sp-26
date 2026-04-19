import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { errorMessage } from "../lib/errors.js";
import type { Deployment, DeploymentStatus } from "../lib/types.js";

type Phase = "polling" | "running" | "failed" | "stopped";

type PollState = {
  deployment?: Deployment;
  phase: Phase;
  error?: string;
};

const TERMINAL: DeploymentStatus[] = ["running", "failed", "stopped"];

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
        const msg = errorMessage(err);
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
