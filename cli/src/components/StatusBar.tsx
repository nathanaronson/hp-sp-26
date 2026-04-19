import { Box, Text, useStdout } from "ink";
import { useElapsed } from "../hooks/useElapsed.js";

type Props = {
  showElapsed?: boolean;
};

export function StatusBar({ showElapsed = false }: Props) {
  const { stdout } = useStdout();
  const width = Math.max(40, Math.min(stdout?.columns ?? 80, 120));
  const { display: elapsed } = useElapsed();

  if (!showElapsed) return null;

  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Box paddingX={1}>
        <Text dimColor>elapsed {elapsed}</Text>
      </Box>
    </Box>
  );
}
