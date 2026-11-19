import { useEffect, useState } from "react";
import * as spotify from "../spotify";
import { segmentColor } from "../colors";
import { clock } from "../format";
import type { Plan, PlanOptions, Segment, Track } from "../types";
import Bars from "./Bars";

interface Props {
  me: spotify.Me;
  plan: Plan | null;
  error: string | null;
  segments: Segment[];
  pool: Track[];
  options: PlanOptions;
  setOptions: (o: PlanOptions) => void;
  workoutName: string;
}

export default function PlaylistStep({ me, plan, error, segments, pool, options, setOptions, workoutName }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hasNew = pool.some((t) => t.source === "new");
  const set = (patch: Partial<PlanOptions>) => setOptions({ ...options, ...patch });
  const picks = plan?.blocks.flatMap((b) => b.picks) ?? [];

  useEffect(() => {
    const d = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    setName(`${workoutName} · ${d}`);
  }, [workoutName]);
  useEffect(() => setSaved(null), [plan]);

  async function save() {
    if (!plan) return;
    setSaving(true);
    setSaveError(null);
    try {
      const desc = plan.blocks
        .filter((b) => b.picks.length)
        .map((b) => `${b.label}: ${Math.round(b.target_bpm)} BPM`)
        .join(" | ")
        .slice(0, 280);
      const r = await spotify.createPlaylist(me, name, `Made with Tempo Run · ${desc}`, picks.map((p) => p.track.uri));
      setSaved(r.url);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!plan) return <p className="quiet progress">Matching songs…</p>;

  const empty = plan.blocks.filter((b) => !b.picks.length).length;
  const loose = plan.blocks.filter((b) => b.picks.length && b.tolerance_used_pct > options.tolerance_pct).length;
  return (
    <>
      <div className="totals">
        <b>{picks.length} {picks.length === 1 ? "song" : "songs"}</b>
        <span>
          {clock(plan.total_music_s)} of music for a {clock(plan.total_workout_s)} run
        </span>
      </div>
      <Bars segments={segments} plan={plan} />

      <div className="row">
        {hasNew && (
          <div className="switch small">
            <button className={options.library_only ? "on" : ""} onClick={() => set({ library_only: true })}>
              My songs only
            </button>
            <button className={!options.library_only ? "on" : ""} onClick={() => set({ library_only: false })}>
              + New songs
            </button>
          </div>
        )}
        <button className="secondary" onClick={() => set({ seed: options.seed + 1 })}>
          ↻ Regenerate
        </button>
      </div>

      {(empty > 0 || loose > 0) && (
        <p className="notice">
          {empty > 0
            ? `${empty} of ${plan.blocks.length} steps had no songs near their BPM.`
            : `Some steps needed a looser BPM match.`}{" "}
          Adding new songs or widening the range under Fine-tune will help.
        </p>
      )}

      <div className="playlist">
        {plan.blocks.map((b, i) => (
          <div className="pl-block" key={i}>
            <div className="pl-head">
              <span className="dot" style={{ background: segmentColor(segments[b.segment_indices[0]]) }} />
              <span className="pl-label">{b.label}</span>
              <span className="quiet">
                {Math.round(b.target_bpm)} BPM · {clock(b.duration_s)}
              </span>
              {b.picks.length ? <Drift s={b.drift_end_s} /> : <span className="drift muted">no match</span>}
            </div>
            {b.picks.map((p) => (
              <div className="song" key={p.track.id}>
                {p.track.image ? <img src={p.track.image} alt="" /> : <div className="noimg" />}
                <div className="song-main">
                  <div className="song-name">
                    {p.track.name}
                    {p.track.source === "new" && <span className="badge">new</span>}
                  </div>
                  <div className="quiet">{p.track.artists.join(", ")}</div>
                </div>
                <div className="song-meta">
                  <span title={p.multiplier !== 1 ? `Song is ${p.track.tempo} BPM, played at half-time` : undefined}>
                    {Math.round(p.effective_bpm)} BPM
                  </span>
                  <span className="quiet">{clock(p.track.duration_s)}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <details className="finetune">
        <summary>Fine-tune matching</summary>
        <div className="ft">
          <label className="slider">
            <span>
              How close song BPM must be: <b>±{options.tolerance_pct}%</b>
            </span>
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
            Allow half-time songs (an 85 BPM song for 170 steps/min)
          </label>
        </div>
      </details>

      <div className="save">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Playlist name" />
        <button className="spotify" onClick={save} disabled={saving || !picks.length}>
          {saving ? "Saving…" : "Save to Spotify"}
        </button>
      </div>
      {saveError && <p className="error">{saveError}</p>}
      {saved && (
        <p className="success">
          Saved. <a href={saved} target="_blank" rel="noreferrer">Open in Spotify ↗</a> Play in order with shuffle off.
        </p>
      )}
    </>
  );
}

function Drift({ s }: { s: number }) {
  const abs = Math.abs(s);
  if (abs <= 20) return <span className="drift good">in sync</span>;
  return (
    <span className={`drift ${abs <= 60 ? "ok" : "bad"}`} title="Music ends this far from the end of the step">
      {s > 0 ? "+" : "−"}
      {clock(abs)}
    </span>
  );
}
