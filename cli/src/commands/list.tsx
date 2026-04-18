import { useEffect } from "react";
import { Text, useApp } from "ink";
import { AppShell } from "../components/AppShell.js";

export function List() {
  const { exit } = useApp();
  useEffect(() => {
    const t = setTimeout(() => exit(), 50);
    return () => clearTimeout(t);
  }, [exit]);

  return (
    <AppShell
      command="list"
      hints={[
        { keys: "↑↓", label: "nav" },
        { keys: "enter", label: "select" },
        { keys: "q", label: "quit" },
      ]}
    >
      <Text dimColor>list view not implemented (phase 4)</Text>
    </AppShell>
  );
}
