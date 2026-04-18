import { Box, Text } from "ink";
import { elapsedSeconds, formatRelativeTime } from "../lib/time.js";
import type { Deployment } from "../lib/types.js";
import { DeploymentSummary } from "./DeploymentSummary.js";
import { StatusBadge } from "./StatusBadge.js";

export function DeploymentDetails({
  deployment,
  showActions = true,
}: {
  deployment: Deployment;
  showActions?: boolean;
}) {
  const port = deployment.ports?.[0];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{deployment.name}</Text>
      <Box marginTop={1}>
        <StatusBadge status={deployment.status} />
        <Text dimColor>  {deployment.id}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text>
          source: <Text color="cyan">{deployment.source.type}</Text>
          <Text dimColor>  {deployment.source.ref}</Text>
        </Text>
        <Text dimColor>updated {formatRelativeTime(deployment.updatedAt)}</Text>
        {deployment.currentStep ? (
          <Text>current step: {deployment.currentStep}</Text>
        ) : null}
        {deployment.status !== "ready" && deployment.url ? (
          <Text>url: {deployment.url}</Text>
        ) : null}
        {deployment.status !== "ready" && deployment.runCommand ? (
          <Text>
            run command: <Text color="cyan">{deployment.runCommand}</Text>
          </Text>
        ) : null}
        {deployment.status !== "ready" && port ? (
          <Text>
            exposed port: {port.internal} → {port.public}
          </Text>
        ) : null}
      </Box>

      {deployment.error ? (
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{deployment.error}</Text>
        </Box>
      ) : null}

      {deployment.status === "ready" ? (
        <DeploymentSummary
          deployment={deployment}
          elapsedSec={elapsedSeconds(deployment.createdAt, deployment.updatedAt)}
        />
      ) : null}

      {showActions ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text dimColor>dploy status {deployment.id}   for more detail</Text>
          <Text dimColor>dploy stop {deployment.id}     to tear down</Text>
        </Box>
      ) : null}
    </Box>
  );
}
