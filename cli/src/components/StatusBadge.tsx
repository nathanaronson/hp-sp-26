import { Box, Text } from "ink";
import type { DeploymentStatus } from "../lib/types.js";

const COLORS: Record<DeploymentStatus, string> = {
  pending: "gray",
  uploading: "cyan",
  provisioning: "cyan",
  cloning: "cyan",
  analyzing: "cyan",
  installing: "cyan",
  starting: "cyan",
  exposing: "cyan",
  ready: "green",
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
