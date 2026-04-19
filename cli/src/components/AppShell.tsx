import { Box } from "ink";
import type { ReactNode } from "react";
import { Header } from "./Header.js";
import { StatusBar } from "./StatusBar.js";
import { KeyHints } from "./KeyHints.js";

type Props = {
  command?: string;
  children: ReactNode;
  identity?: { email: string; org?: string };
  showElapsed?: boolean;
  hints?: { keys: string; label: string }[];
};

export function AppShell({
  command,
  children,
  showElapsed,
  hints,
}: Props) {
  return (
    <Box flexDirection="column">
      <Header command={command} />
      <Box flexDirection="column" paddingX={1}>
        {children}
      </Box>
      {hints && hints.length > 0 ? (
        <Box paddingX={1} marginTop={1}>
          <KeyHints hints={hints} />
        </Box>
      ) : null}
      <StatusBar showElapsed={showElapsed} />
    </Box>
  );
}
