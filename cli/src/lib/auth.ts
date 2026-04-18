import { config } from "./config.js";

export function assertAuthed(): string {
  const token = config.get("token");
  if (!token) {
    throw new Error("Not logged in. Run `dploy login` first.");
  }

  return token;
}
