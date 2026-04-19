import { Box, Text } from "ink";

export type StepState = "pending" | "running" | "done" | "failed";

type Props = {
  state: StepState;
  label: string;
  details?: string[];
};

export function Step({ state, label, details }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box marginRight={1}>{renderIcon(state)}</Box>
        <Text color={state === "failed" ? "red" : undefined}>{label}</Text>
      </Box>
      {details?.map((d, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>└─ {d}</Text>
        </Box>
      ))}
    </Box>
  );
}

function renderIcon(state: StepState) {
  switch (state) {
    case "done":
      return <Text color="green">✔</Text>;
    case "running":
      return <Text color="cyan">…</Text>;
    case "failed":
      return <Text color="red">✖</Text>;
    case "pending":
    default:
      return <Text dimColor>○</Text>;
  }
}
