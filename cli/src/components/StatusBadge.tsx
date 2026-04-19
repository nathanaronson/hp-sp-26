import { Box, Text } from "ink";
import type { DeploymentStatus } from "../lib/types.js";

const COLORS: Record<DeploymentStatus, string> = {
  pending: "gray",
  provisioning: "cyan",
  analyzing: "cyan",
  building: "cyan",
  exposing: "cyan",
  running: "green",
  failed: "red",
  stopped: "gray",
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <Box>
      <Text color={COLORS[status]}>●</Text>
      <Text> {status}</Text>
    </Box>
  );
}
