import { Box, Text } from "ink";
import type { Deployment } from "../lib/types.js";

export function DeploymentSummary({
  deployment,
  elapsedSec,
}: {
  deployment: Deployment;
  elapsedSec?: number;
}) {
  const port = deployment.ports?.[0];
  return (
    <Box flexDirection="column">
      <Text color="green">🚀  Deployed</Text>
      <Box marginLeft={2}>
        <Text>{deployment.url ?? ""}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {deployment.runCommand ? (
          <Text>agent decided:   <Text color="cyan">{deployment.runCommand}</Text></Text>
        ) : null}
        {port ? (
          <Text>exposed port:    {port.internal} → {port.public}</Text>
        ) : null}
        {elapsedSec !== undefined ? (
          <Text>time to deploy:  {elapsedSec}s</Text>
        ) : null}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>dploy stop {deployment.id}   to tear down</Text>
        <Text dimColor>dploy open {deployment.id}   to open in browser</Text>
      </Box>
    </Box>
  );
}
