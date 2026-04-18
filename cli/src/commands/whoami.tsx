import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import { Spinner } from "@inkjs/ui";
import { AppShell } from "../components/AppShell.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.js";
import type { AuthMe } from "../lib/types.js";

export function Whoami() {
  const { exit } = useApp();
  const { isAuthed } = useAuth();
  const [identity, setIdentity] = useState<AuthMe>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isAuthed) {
      setError("Not logged in.");
      setTimeout(() => exit(), 50);
      process.exitCode = 1;
      return;
    }
    api<AuthMe>("/api/auth/me").then(
      (me) => {
        setIdentity(me);
        setTimeout(() => exit(), 50);
      },
      (err) => {
        setError(err instanceof ApiError ? err.message : String(err));
        setTimeout(() => exit(), 50);
        process.exitCode = 1;
      },
    );
  }, [isAuthed, exit]);

  const body = error ? (
    <ErrorPanel message={error} hint="Run `dploy login`." />
  ) : identity ? (
    <Box>
      <Text>{identity.user.email}</Text>
      <Text dimColor>  ({identity.org.slug})</Text>
    </Box>
  ) : (
    <Box>
      <Spinner />
      <Text> Fetching user…</Text>
    </Box>
  );

  return (
    <AppShell
      command="whoami"
      identity={
        identity
          ? { email: identity.user.email, org: identity.org.slug }
          : undefined
      }
    >
      {body}
    </AppShell>
  );
}
