import { Box, Text } from "ink";
import type { Deployment } from "../lib/types.js";

export function DeploymentSummary({
  deployment,
  elapsedSec,
}: {
  deployment: Deployment;
  elapsedSec?: number;
}) {
  const isCli = deployment.kind === "cli";
  const port = deployment.ports?.[0];
  const headline = isCli ? "🖥   CLI live" : "🚀  Deployed";
  const urlLabel = isCli ? "web terminal:" : undefined;

  return (
    <Box flexDirection="column">
      <Text color="green">{headline}</Text>
      <Box marginLeft={2}>
        {urlLabel ? <Text dimColor>{urlLabel} </Text> : null}
        <Text>{deployment.url ?? ""}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {isCli && deployment.startCommand ? (
          <Text>entrypoint:      <Text color="cyan">{deployment.startCommand}</Text></Text>
        ) : null}
        {!isCli && deployment.runCommand ? (
          <Text>agent decided:   <Text color="cyan">{deployment.runCommand}</Text></Text>
        ) : null}
        {!isCli && port ? (
          <Text>exposed port:    {port.internal} → {port.public}</Text>
        ) : null}
        {elapsedSec !== undefined ? (
          <Text>time to deploy:  {elapsedSec}s</Text>
        ) : null}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {isCli ? (
          <Text dimColor>
            anyone with the link can use the CLI in their browser — no auth.
          </Text>
        ) : null}
        <Text dimColor>dploy stop {deployment.id}   to tear down</Text>
        <Text dimColor>dploy open {deployment.id}   to open in browser</Text>
      </Box>
    </Box>
  );
}
