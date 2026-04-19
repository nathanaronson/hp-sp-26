export function formatRelativeTime(value: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - parseApiTime(value)) / 1000));

  if (diffSec < 60) return "<1m ago";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function elapsedSeconds(start: string, end: string): number {
  return Math.max(1, Math.round((parseApiTime(end) - parseApiTime(start)) / 1000));
}

export function parseApiTime(value: string): number {
  const trimmed = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed);
  const normalized = hasZone ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}
