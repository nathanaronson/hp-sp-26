import { Box, Text } from "ink";
import { elapsedSeconds, formatRelativeTime } from "../lib/time.js";
import type { Deployment } from "../lib/types.js";
import { DeploymentSummary } from "./DeploymentSummary.js";
import { StatusBadge } from "./StatusBadge.js";

export function DeploymentDetails({
  deployment,
  showActions = true,
  showAdvanced = false,
}: {
  deployment: Deployment;
  showActions?: boolean;
  showAdvanced?: boolean;
}) {
  const port = deployment.ports?.[0];
  const extraUrls = deployment.tunnelUrls
    ? Object.entries(deployment.tunnelUrls).filter(([, url]) => url !== deployment.url)
    : [];
  const isLive = deployment.status === "running";

  return (
    <Box flexDirection="column">
      <Text bold>{deployment.name}</Text>
      <Box>
        <StatusBadge status={deployment.status} />
        <Text dimColor>  {deployment.id}</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>updated: {formatRelativeTime(deployment.updatedAt)}</Text>
        {deployment.currentStep ? (
          <Text>latest: {deployment.currentStep}</Text>
        ) : null}
        {deployment.url ? (
          <Text>{isLive ? "public url" : "pending url"}: {deployment.url}</Text>
        ) : null}
        {showAdvanced ? (
          <>
            <Text>
              source: <Text color="cyan">{deployment.source.type}</Text>
              <Text dimColor>  {deployment.source.ref}</Text>
            </Text>
            {deployment.runtime ? <Text>runtime: {deployment.runtime}</Text> : null}
            {deployment.backendUrl && deployment.backendUrl !== deployment.url ? (
              <Text>backend url: {deployment.backendUrl}</Text>
            ) : null}
            {deployment.runCommand ? (
              <Text>
                run command: <Text color="cyan">{deployment.runCommand}</Text>
              </Text>
            ) : null}
            {port ? (
              <Text>
                exposed port: {port.internal} → {port.public}
              </Text>
            ) : null}
            {extraUrls.slice(0, 3).map(([label, url]) => (
              <Text key={label}>{label}: {url}</Text>
            ))}
          </>
        ) : null}
      </Box>

      {deployment.error ? (
        <Box marginLeft={2}>
          <Text color="red">{deployment.error}</Text>
        </Box>
      ) : null}

      {deployment.status === "running" ? (
        <DeploymentSummary
          deployment={deployment}
          elapsedSec={elapsedSeconds(deployment.createdAt, deployment.updatedAt)}
          showAdvanced={showAdvanced}
        />
      ) : null}

      {showActions ? (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>dploy status {deployment.id}   for more detail</Text>
          <Text dimColor>dploy stop {deployment.id}     to tear down</Text>
        </Box>
      ) : null}
    </Box>
  );
}
