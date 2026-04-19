import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GITHUB_RE =
  /^(https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

export function isGithubUrl(input: string): boolean {
  return GITHUB_RE.test(input.trim());
}

export function parseGithubUrl(input: string): { owner: string; repo: string } {
  const m = input.trim().match(GITHUB_RE);
  if (!m) throw new Error(`Not a GitHub URL: ${input}`);
  return { owner: m[2]!, repo: m[3]! };
}

export function normalizeGithubUrl(input: string): string {
  const { owner, repo } = parseGithubUrl(input);
  return `https://github.com/${owner}/${repo}`;
}

export async function detectGithubUrlFromGit(cwd: string): Promise<string | undefined> {
  const remotes = await listGitRemotes(cwd);
  const orderedRemotes = prioritizeOrigin(remotes);

  for (const remote of orderedRemotes) {
    const remoteUrl = await getRemoteUrl(cwd, remote);
    if (remoteUrl && isGithubUrl(remoteUrl)) {
      return normalizeGithubUrl(remoteUrl);
    }
  }

  return undefined;
}

async function listGitRemotes(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "remote"], { cwd });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getRemoteUrl(cwd: string, remote: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "remote", "get-url", remote],
      { cwd },
    );
    const url = stdout.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

function prioritizeOrigin(remotes: string[]): string[] {
  return [...remotes].sort((left, right) => {
    if (left === "origin") return -1;
    if (right === "origin") return 1;
    return left.localeCompare(right);
  });
}
