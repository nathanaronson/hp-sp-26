import { Box, Text } from "ink";

type Hint = { keys: string; label: string };

export function KeyHints({ hints }: { hints: Hint[] }) {
  return (
    <Box>
      {hints.map((h, i) => (
        <Box key={h.keys} marginRight={2}>
          {i > 0 ? <Text dimColor>· </Text> : null}
          <Text color="cyan">{h.keys}</Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
