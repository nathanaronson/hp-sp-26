import { useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { AppShell } from "../components/AppShell.js";

type Props = {
  target?: string;
  envInline: string[];
  envFile?: string;
  name?: string;
  follow: boolean;
};

export function Deploy({ target }: Props) {
  const { exit } = useApp();
  useEffect(() => {
    const t = setTimeout(() => exit(), 50);
    return () => clearTimeout(t);
  }, [exit]);

  return (
    <AppShell command="deploy">
      <Box flexDirection="column">
        <Text>
          Target: <Text color="cyan">{target ?? "(current directory)"}</Text>
        </Text>
        <Box marginTop={1}>
          <Text dimColor>deploy pipeline not wired up yet (phase 2/3)</Text>
        </Box>
      </Box>
    </AppShell>
  );
}
