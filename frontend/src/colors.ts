import type { Segment } from "./types";

const EASY = [63, 182, 168];
const HARD = [255, 122, 26];

export function intensityColor(i: number) {
  const c = EASY.map((e, k) => Math.round(e + (HARD[k] - e) * Math.max(0, Math.min(1, i))));
  return `rgb(${c.join(",")})`;
}

export const segmentColor = (s: Segment) => (s.kind === "rest" ? "var(--rest)" : intensityColor(s.intensity));
