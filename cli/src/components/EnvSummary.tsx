import { Box, Text } from "ink";

export function EnvSummary({ env }: { env: Record<string, string> }) {
  const keys = Object.keys(env);
  if (keys.length === 0) return null;
  return (
    <Box>
      <Text dimColor>
        Env variables ({keys.length}): {keys.join(", ")}
      </Text>
    </Box>
  );
}
