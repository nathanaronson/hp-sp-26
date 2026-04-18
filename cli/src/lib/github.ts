const GITHUB_RE =
  /^(https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)(\.git)?\/?$/i;

export function isGithubUrl(input: string): boolean {
  return GITHUB_RE.test(input.trim());
}

export function parseGithubUrl(input: string): { owner: string; repo: string } {
  const m = input.trim().match(GITHUB_RE);
  if (!m) throw new Error(`Not a GitHub URL: ${input}`);
  return { owner: m[2]!, repo: m[3]! };
}
