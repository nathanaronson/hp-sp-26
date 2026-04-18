import { Box } from "ink";
import { Step, type StepState } from "./Step.js";

export type StepItem = {
  key: string;
  label: string;
  state: StepState;
  details?: string[];
};

export function StepList({ steps }: { steps: StepItem[] }) {
  return (
    <Box flexDirection="column">
      {steps.map((s) => (
        <Step key={s.key} state={s.state} label={s.label} details={s.details} />
      ))}
    </Box>
  );
}
