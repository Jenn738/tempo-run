import { useEffect, useState } from "react";
import * as spotify from "../spotify";
import { intensityColor, segmentColor } from "../colors";
import { clock } from "../format";
import type { Plan, PlanOptions, Segment, Track, Unit } from "../types";

interface Props {
  me: spotify.Me | null;
  plan: Plan | null;
  error: string | null;
  segments: Segment[];
  pool: Track[];
  options: PlanOptions;
  setOptions: (o: PlanOptions) => void;
  workoutName: string;
  unit: Unit;
}

export default function PlanView({ me, plan, error, segments, pool, options, setOptions, workoutName }: Props) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ url: string; name: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const hasNew = pool.some((t) => t.source === "new");

  useEffect(() => {
    const d = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    setName(`${workoutName} · ${d}${options.library_only ? "" : " (+ new)"}`);
    setCreated(null);
  }, [workoutName, options.library_only]);

  const set = (patch: Partial<PlanOptions>) => setOptions({ ...options, ...patch });
  const picks = plan?.blocks.flatMap((b) => b.picks) ?? [];

  async function create() {
    if (!me || !plan) return;
    setCreating(true);
    setCreateError(null);
    try {
      const desc = plan.blocks
        .filter((b) => b.picks.length)
        .map((b) => `${b.label}: ${Math.round(b.target_bpm)} BPM`)
        .join(" | ")
        .slice(0, 290);
      const r = await spotify.createPlaylist(me, name, `Tempo Run · ${desc}`, picks.map((p) => p.track.uri));
      setCreated({ url: r.url, name });
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="card plan">
      <div className="card-head">
        <h2>
          <span className="step">3</span> Playlist
        </h2>
        {plan && (
          <div className="plan-stats">
            <span>{picks.length} songs</span>
            <span>
              music {clock(plan.total_music_s)} / run {clock(plan.total_workout_s)}
            </span>
          </div>
        )}
      </div>

      <div className="controls">
        <div className="seg-toggle" role="radiogroup" aria-label="Which songs">
          <button className={options.library_only ? "on" : ""} onClick={() => set({ library_only: true })}>
            My library only
          </button>
          <button
            className={!options.library_only ? "on" : ""}
            onClick={() => set({ library_only: false })}
            title={hasNew ? "" : "Turn on 'New songs' in Music and reload to add new songs"}
          >
            Library + new songs
          </button>
        </div>
        <label className="slider">
          BPM range ±{options.tolerance_pct}%
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={options.tolerance_pct}
            onChange={(e) => set({ tolerance_pct: Number(e.target.value) })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={options.allow_half_time} onChange={(e) => set({ allow_half_time: e.target.checked })} />
          Half-time songs count (85 BPM → 170)
        </label>
        <button className="btn ghost" onClick={() => set({ seed: options.seed + 1 })} disabled={!plan}>
          ↻ Shuffle picks
        </button>
      </div>
      {!options.library_only && pool.length > 0 && !hasNew && (
        <p className="hint">No new songs loaded yet: turn on "New songs" in Music and reload.</p>
      )}

      {error && <p className="error">{error}</p>}
      {!plan ? (
        <div className="placeholder">
          <div className="ph-bars">
            {segments.map((s, i) => (
              <span key={i} style={{ flex: s.duration_s, background: segmentColor(s) }} />
            ))}
          </div>
          <p>{segments.length ? "Load your music to fill these steps with songs." : "Add a workout to get started."}</p>
        </div>
      ) : (
        <>
          <Timeline plan={plan} segments={segments} />
          <div className="blocks">
            {plan.blocks.map((b, i) => (
              <div className="block" key={i}>
                <div className="block-head">
                  <span className="bar" style={{ background: segmentColor(segments[b.segment_indices[0]]) }} />
                  <div className="bh-main">
                    <div className="bh-title">
                      <span className="group">{b.group}</span> {b.label}
                    </div>
                    <div className="bh-meta">
                      {clock(b.start_s)}–{clock(b.start_s + b.duration_s)} · target <b>{Math.round(b.target_bpm)} BPM</b>
                    </div>
                  </div>
                  <Drift s={b.drift_end_s} />
                </div>
                {b.note && <p className="note">{b.note}</p>}
                <ol className="tracks">
                  {b.picks.map((p) => (
                    <li key={p.track.id}>
                      {p.track.image ? <img src={p.track.image} alt="" /> : <div className="noimg">♪</div>}
                      <div className="t-main">
                        <div className="t-name">
                          {p.track.name}
                          {p.track.source === "new" && <span className="badge">NEW</span>}
                        </div>
                        <div className="t-artist">{p.track.artists.join(", ")}</div>
                      </div>
                      <div className="t-bpm" title={`Song tempo ${p.track.tempo} BPM`}>
                        {Math.round(p.effective_bpm)}
                        <small>{p.multiplier === 2 ? "½-time" : p.multiplier === 0.5 ? "2×" : "BPM"}</small>
                      </div>
                      <div className="t-dur">{clock(p.track.duration_s)}</div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <div className="create">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Playlist name" />
            <button className="btn spotify-btn" onClick={create} disabled={creating || !picks.length || !me}>
              {creating ? "Creating…" : "Save to Spotify"}
            </button>
          </div>
          <p className="hint">Saves as a private playlist. Play it in order with shuffle off so songs line up with each step.</p>
          {createError && <p className="error">{createError}</p>}
          {created && (
            <p className="success">
              Saved “{created.name}”.{" "}
              <a href={created.url} target="_blank" rel="noreferrer">
                Open in Spotify ↗
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Drift({ s }: { s: number }) {
  const abs = Math.abs(s);
  const cls = abs <= 20 ? "good" : abs <= 60 ? "ok" : "bad";
  return (
    <span className={`drift ${cls}`} title="Where the music ends compared to the end of this step">
      {abs <= 5 ? "in sync" : `${s > 0 ? "+" : "−"}${clock(abs)}`}
    </span>
  );
}

function Timeline({ plan, segments }: { plan: Plan; segments: Segment[] }) {
  const total = Math.max(plan.total_workout_s, plan.total_music_s);
  const pct = (s: number) => `${(s / total) * 100}%`;
  let t = 0;
  const segBars = segments.map((s, i) => {
    const el = (
      <div
        key={i}
        className="tl-seg"
        style={{ left: pct(t), width: pct(s.duration_s), background: segmentColor(s) }}
        title={`${s.label} · ${clock(s.duration_s)} · ${Math.round(s.cadence)} BPM`}
      >
        <span>{s.kind === "rest" ? "" : Math.round(s.cadence)}</span>
      </div>
    );
    t += s.duration_s;
    return el;
  });
  const picks = plan.blocks.flatMap((b) =>
    b.picks.map((p) => ({ p, intensity: segments[b.segment_indices[0]]?.intensity ?? 0 })),
  );
  const ticks: number[] = [];
  for (let m = 0; m * 60 <= total; m += total > 2400 ? 10 : 5) ticks.push(m * 60);

  return (
    <div className="timeline">
      <div className="tl-row-label">Run</div>
      <div className="tl-row">{segBars}</div>
      <div className="tl-row-label">Music</div>
      <div className="tl-row music">
        {picks.map(({ p, intensity }) => (
          <div
            key={p.track.id}
            className="tl-track"
            style={{ left: pct(p.starts_at_s), width: pct(p.track.duration_s), borderColor: intensityColor(intensity) }}
            title={`${p.track.name} · ${Math.round(p.effective_bpm)} BPM · ${clock(p.track.duration_s)}`}
          >
            <span>{p.track.name}</span>
          </div>
        ))}
      </div>
      <div />
      <div className="tl-ticks">
        {ticks.map((s) => (
          <span key={s} style={{ left: pct(s) }}>
            {s / 60}′
          </span>
        ))}
      </div>
    </div>
  );
}
