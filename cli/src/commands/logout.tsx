import { useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { AppShell } from "../components/AppShell.js";
import { config } from "../lib/config.js";

export function Logout() {
  const { exit } = useApp();
  const hadToken = Boolean(config.get("token"));

  useEffect(() => {
    config.delete("token");
    config.delete("mock");
    setTimeout(() => exit(), 50);
  }, [exit]);

  return (
    <AppShell command="logout">
      <Box>
        <Text color={hadToken ? "green" : undefined}>
          {hadToken ? "✔ Logged out." : "You were not logged in."}
        </Text>
      </Box>
    </AppShell>
  );
}
