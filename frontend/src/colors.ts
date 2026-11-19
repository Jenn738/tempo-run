import type { Segment } from "./types";

// easy → hard ("Berry"): lavender → purple → purple-magenta → pink
const STOPS: [number, number[]][] = [
  [0, [205, 180, 255]],
  [0.35, [160, 110, 240]],
  [0.7, [190, 72, 200]],
  [1, [222, 62, 160]],
];
export const REST_COLOR = "rgb(222, 214, 232)";

export function intensityColor(i: number) {
  const t = Math.max(0, Math.min(1, i));
  for (let k = 1; k < STOPS.length; k++) {
    const [t1, c1] = STOPS[k];
    const [t0, c0] = STOPS[k - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * f)).join(",")})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(",")})`;
}

export const segmentColor = (s: Segment) => (s.kind === "rest" ? REST_COLOR : intensityColor(s.intensity));
