import { config } from "../lib/config.js";

export function useAuth(): { token: string | undefined; isAuthed: boolean } {
  const token = config.get("token");
  return { token, isAuthed: Boolean(token) };
}
