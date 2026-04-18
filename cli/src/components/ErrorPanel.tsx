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
      flexDirection="column"
    >
      <Text color="red" bold>
        ✖ Something went wrong
      </Text>
      <Text>{message}</Text>
      {hint ? (
        <Box marginTop={1}>
          <Text dimColor>Try: </Text>
          <Text>{hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
