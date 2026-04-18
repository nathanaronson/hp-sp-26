import { Box, Text } from "ink";

type Props = {
  message: string;
  hint?: string;
};

export function ErrorPanel({ message, hint }: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor="red"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Text color="red" bold>
        ✖ Something went wrong
      </Text>
      <Text>{message}</Text>
      {hint ? (
        <Text dimColor>Try: {hint}</Text>
      ) : null}
    </Box>
  );
}
