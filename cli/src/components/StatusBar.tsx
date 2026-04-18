import { Box, Text, useStdout } from "ink";
import { useAuth } from "../hooks/useAuth.js";
import { useElapsed } from "../hooks/useElapsed.js";
import { config } from "../lib/config.js";

type Props = {
  identity?: { email: string; org?: string };
  showElapsed?: boolean;
};

export function StatusBar({ identity, showElapsed = false }: Props) {
  const { stdout } = useStdout();
  const width = Math.max(40, Math.min(stdout?.columns ?? 80, 120));
  const { isAuthed } = useAuth();
  const { display: elapsed } = useElapsed();
  const apiUrl = config.get("apiUrl").replace(/^https?:\/\//, "");

  return (
    <Box flexDirection="column" marginTop={1} width={width}>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Box paddingX={1}>
        <Text color={isAuthed ? "green" : "gray"}>●</Text>
        <Text>
          {" "}
          {identity ? identity.email : isAuthed ? "logged in" : "not logged in"}
        </Text>
        {identity?.org ? <Text dimColor>  {identity.org}</Text> : null}
        <Text dimColor>   {apiUrl}</Text>
        {showElapsed ? <Text dimColor>   elapsed {elapsed}</Text> : null}
      </Box>
    </Box>
  );
}
