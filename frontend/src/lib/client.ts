import { client } from "../client/client.gen";

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

client.setConfig({
  baseUrl: API_BASE_URL,
  // Send the session cookie set by /api/v1/auth/github/callback.
  credentials: "include",
});
