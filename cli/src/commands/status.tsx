import { useEffect } from "react";
import { Text, useApp } from "ink";
import { AppShell } from "../components/AppShell.js";

export function Status({ id }: { id: string }) {
  const { exit } = useApp();
  useEffect(() => {
    const t = setTimeout(() => exit(), 50);
    return () => clearTimeout(t);
  }, [exit]);

  return (
    <AppShell command={`status ${id}`}>
      <Text dimColor>status view not implemented (phase 4)</Text>
    </AppShell>
  );
}
