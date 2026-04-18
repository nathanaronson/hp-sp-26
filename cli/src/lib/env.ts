import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

type LoadEnvArgs = {
  cwd?: string;
  file?: string;
  inline?: string[];
  skipAuto?: boolean;
};

export function loadEnv(args: LoadEnvArgs = {}): Record<string, string> {
  const { cwd = process.cwd(), file, inline = [], skipAuto = false } = args;
  const out: Record<string, string> = {};

  if (file) {
    const abs = resolve(cwd, file);
    if (!existsSync(abs)) throw new Error(`env file not found: ${file}`);
    Object.assign(out, dotenv.parse(readFileSync(abs)));
  } else if (!skipAuto) {
    const abs = resolve(cwd, ".env");
    if (existsSync(abs)) Object.assign(out, dotenv.parse(readFileSync(abs)));
  }

  for (const pair of inline) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`invalid --env value: ${pair}`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  return out;
}
