import { useEffect } from "react";
import { Text, useApp } from "ink";
import { AppShell } from "../components/AppShell.js";

export function Stop({ id }: { id: string }) {
  const { exit } = useApp();
  useEffect(() => {
    const t = setTimeout(() => exit(), 50);
    return () => clearTimeout(t);
  }, [exit]);

  return (
    <AppShell
      command={`stop ${id}`}
      hints={[
        { keys: "y", label: "confirm" },
        { keys: "n", label: "cancel" },
      ]}
    >
      <Text dimColor>stop flow not implemented (phase 4)</Text>
    </AppShell>
  );
}
