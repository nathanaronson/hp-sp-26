import { Box, Text } from "ink";
import type { Deployment } from "../lib/types.js";

export function DeploymentSummary({
  deployment,
  elapsedSec,
  showAdvanced = false,
}: {
  deployment: Deployment;
  elapsedSec?: number;
  showAdvanced?: boolean;
}) {
  const isCli = deployment.kind === "cli";
  const port = deployment.ports?.[0];
  const headline = isCli ? "CLI live" : "Deployment live";
  const entrypoint =
    deployment.entrypoint?.join(" ") ?? deployment.startCommand;

  return (
    <Box flexDirection="column">
      <Text color="green">{headline}</Text>
      <Box marginLeft={2}>
        <Text dimColor>{isCli ? "web terminal: " : "public URL: "}</Text>
        <Text>{deployment.url ?? ""}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {!isCli && deployment.backendUrl && deployment.backendUrl !== deployment.url ? (
          <Text>backend URL:     {deployment.backendUrl}</Text>
        ) : null}
        {elapsedSec !== undefined ? (
          <Text>time to deploy:  {elapsedSec}s</Text>
        ) : null}
        {showAdvanced && isCli && entrypoint ? (
          <Text>entrypoint:      <Text color="cyan">{entrypoint}</Text></Text>
        ) : null}
        {showAdvanced && !isCli && deployment.runCommand ? (
          <Text>start command:   <Text color="cyan">{deployment.runCommand}</Text></Text>
        ) : null}
        {showAdvanced && !isCli && port ? (
          <Text>exposed port:    {port.internal} → {port.public}</Text>
        ) : null}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {isCli ? (
          <Text dimColor>
            anyone with the link can use the CLI in their browser; no auth.
          </Text>
        ) : null}
        <Text dimColor>dploy stop {deployment.id}   to tear down</Text>
        <Text dimColor>dploy open {deployment.id}   to open in browser</Text>
      </Box>
    </Box>
  );
}
