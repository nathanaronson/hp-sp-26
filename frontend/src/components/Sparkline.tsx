import { useMemo } from "react";

function miniSpark(seed = 1, pts = 16) {
  const arr = [];
  for (let i = 0; i < pts; i++) {
    const v =
      0.5 +
      0.35 * Math.sin(i * 0.7 + seed) +
      0.15 * Math.sin(i * 1.9 + seed * 2) +
      (i / pts) * 0.1;
    arr.push(Math.max(0.1, Math.min(1, v)));
  }
  return arr;
}

interface SparklineProps {
  seed?: number;
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({ seed = 1, color = "var(--ok-ink)", width = 80, height = 24 }: SparklineProps) {
  const pts = useMemo(() => miniSpark(seed, 16), [seed]);
  const w = width;
  const h = height;
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (pts.length - 1)) * w},${h - p * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="sparkline" viewBox={`0 0 ${w} ${h}`}>
      <path d={`${d} L ${w},${h} L 0,${h} Z`} fill={color} opacity="0.18" />
      <path
        d={d}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
