import { Box, Text, useStdout } from "ink";

export function Header({ command }: { command?: string }) {
  const { stdout } = useStdout();
  const width = Math.max(40, Math.min(stdout?.columns ?? 80, 120));

  return (
    <Box flexDirection="column" width={width}>
      <Box width={width} paddingX={1}>
        <Box>
          <Text bold>dploy</Text>
          {command ? <Text dimColor>  / {command}</Text> : null}
        </Box>
      </Box>
      <Text dimColor>{"─".repeat(width)}</Text>
    </Box>
  );
}
