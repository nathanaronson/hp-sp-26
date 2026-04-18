import { Box, Text, useStdout } from "ink";
import { VERSION } from "../lib/version.js";

export function Header({ command }: { command?: string }) {
  const { stdout } = useStdout();
  const width = Math.max(40, Math.min(stdout?.columns ?? 80, 120));

  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between" width={width} paddingX={1}>
        <Box>
          <Text color="cyan" bold>
            ▲ dploy
          </Text>
          {command ? <Text dimColor>  · {command}</Text> : null}
        </Box>
        <Text dimColor>v{VERSION}</Text>
      </Box>
      <Text dimColor>{"─".repeat(width)}</Text>
    </Box>
  );
}
