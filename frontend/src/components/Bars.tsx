import { segmentColor } from "../colors";
import { clock } from "../format";
import type { Plan, Segment } from "../types";

const W = 1000;
const H = 140;

/** The workout as a smooth line over a soft fill: width = time, height = BPM,
 * color blends from step to step. With a plan, songs are drawn underneath. */
export default function Bars({ segments, plan }: { segments: Segment[]; plan?: Plan | null }) {
  if (!segments.length) return null;
  const workout = segments.reduce((a, s) => a + s.duration_s, 0);
  const total = Math.max(workout, plan?.total_music_s ?? 0);
  const runs = segments.filter((s) => s.kind === "run").map((s) => s.cadence);
  const lo = (runs.length ? Math.min(...runs) : 150) - 14;
  const hi = runs.length ? Math.max(...runs) : 180;
  const top = (s: Segment) =>
    s.kind === "rest" ? H * 0.78 : H - (0.32 + ((s.cadence - lo) / Math.max(hi - lo, 1)) * 0.6) * H;

  // x positions
  const xs: { x0: number; x1: number; y: number; s: Segment }[] = [];
  let t = 0;
  for (const s of segments) {
    xs.push({ x0: (t / total) * W, x1: ((t + s.duration_s) / total) * W, y: top(s), s });
    t += s.duration_s;
  }

  // smooth step line: flat tops joined by short S-curves
  let line = `M0 ${xs[0].y}`;
  xs.forEach((p, i) => {
    const next = xs[i + 1];
    if (!next) {
      line += ` L${p.x1} ${p.y}`;
      return;
    }
    const w = Math.min(14, (p.x1 - p.x0) / 3, (next.x1 - next.x0) / 3);
    line += ` L${p.x1 - w} ${p.y} C${p.x1} ${p.y} ${p.x1} ${next.y} ${p.x1 + w} ${next.y}`;
  });
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  const pct = (s: number) => `${(s / total) * 100}%`;
  const end = (workout / total) * 100;

  return (
    <div className="graph">
      <div className="graph-area">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="wk-grad" gradientUnits="userSpaceOnUse" x1="0" x2={W} y1="0" y2="0">
              {xs.map((p, i) => (
                <stop key={i} offset={((p.x0 + p.x1) / 2 / W).toFixed(4)} stopColor={segmentColor(p.s)} />
              ))}
            </linearGradient>
            <linearGradient id="wk-fade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="white" stopOpacity="0" />
              <stop offset="1" stopColor="white" stopOpacity="1" />
            </linearGradient>
            <mask id="wk-mask">
              <rect x="0" y="0" width={W} height={H} fill="white" />
              <rect x="0" y="0" width={W} height={H} fill="url(#wk-fade)" opacity="0.6" />
            </mask>
          </defs>
          <path d={area} fill="url(#wk-grad)" opacity="0.22" mask="url(#wk-mask)" />
          <path
            d={line}
            fill="none"
            stroke="url(#wk-grad)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {xs.map((p, i) =>
          p.s.kind === "rest" ? null : (
            <span
              key={i}
              className="graph-label"
              style={{ left: `${((p.x0 + p.x1) / 2 / W) * 100}%`, top: `calc(20px + ${(p.y / H).toFixed(4)} * (100% - 20px))` }}
              title={`${p.s.label} · ${clock(p.s.duration_s)}`}
            >
              {Math.round(p.s.cadence)}
            </span>
          ),
        )}
      </div>
      {plan && (
        <div className="song-strip">
          {plan.blocks.flatMap((b) =>
            b.picks.map((p) => (
              <div
                key={p.track.id}
                className="song-chip"
                style={{
                  left: pct(p.starts_at_s),
                  width: pct(p.track.duration_s),
                  ["--c" as string]: segmentColor(segments[b.segment_indices[0]]),
                }}
                title={`${p.track.name} · ${Math.round(p.effective_bpm)} BPM · ${clock(p.track.duration_s)}`}
              >
                {p.track.name}
              </div>
            )),
          )}
        </div>
      )}
      <div className="graph-axis">
        <span>0:00</span>
        <span style={{ position: "absolute", left: `${end}%`, transform: "translateX(-100%)" }}>{clock(workout)}</span>
      </div>
    </div>
  );
}
