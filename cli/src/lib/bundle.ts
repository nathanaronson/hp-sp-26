import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { create as tarCreate } from "tar";
import ignore, { type Ignore } from "ignore";

const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
  ".env",
  ".env.*",
  "*.log",
  ".dploy",
];

export type BundleResult = {
  path: string;
  size: number;
};

export async function bundleDir(cwd: string): Promise<BundleResult> {
  const ig: Ignore = ignore().add(DEFAULT_IGNORES);
  const gitignore = join(cwd, ".gitignore");
  const dployignore = join(cwd, ".dployignore");
  if (existsSync(gitignore)) ig.add(readFileSync(gitignore, "utf8"));
  if (existsSync(dployignore)) ig.add(readFileSync(dployignore, "utf8"));

  const outPath = join(
    tmpdir(),
    `dploy-${randomBytes(6).toString("hex")}.tar.gz`,
  );

  await tarCreate(
    {
      gzip: true,
      cwd,
      file: outPath,
      filter: (path) => {
        const rel = relative(cwd, join(cwd, path));
        if (!rel || rel === ".") return true;
        return !ig.ignores(rel);
      },
    },
    ["."],
  );

  const size = statSync(outPath).size;
  return { path: outPath, size };
}
