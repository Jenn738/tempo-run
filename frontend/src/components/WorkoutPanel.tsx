import { useEffect, useState } from "react";
import { api, type AppConfig } from "../api";
import { segmentColor } from "../colors";
import { clock, distance, pace, parseClock } from "../format";
import type { RunnerProfile, Segment, StravaActivity } from "../types";

export type WorkoutSource =
  | { kind: "text"; text: string }
  | { kind: "strava"; id: number; name: string; useCadence: boolean };

interface Props {
  cfg: AppConfig;
  source: WorkoutSource;
  setSource: (s: WorkoutSource) => void;
  profile: RunnerProfile;
  setProfile: (p: RunnerProfile) => void;
  segments: Segment[];
  editSegment: (i: number, patch: Partial<Segment>) => void;
  error: string | null;
}

export default function WorkoutPanel({ cfg, source, setSource, profile, setProfile, segments, editSegment, error }: Props) {
  const [tab, setTab] = useState<"text" | "strava">(source.kind);
  const [draft, setDraft] = useState(source.kind === "text" ? source.text : "");
  const [activities, setActivities] = useState<StravaActivity[] | null>(null);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [useCadence, setUseCadence] = useState(true);

  useEffect(() => {
    if (tab !== "strava" || !cfg.stravaConnected || activities) return;
    api
      .stravaActivities()
      .then((a) => setActivities(a.filter((x) => /run|walk|hike/i.test(x.type))))
      .catch((e) => setStravaError(e.message));
  }, [tab, cfg.stravaConnected, activities]);

  useEffect(() => {
    if (tab !== "text") return;
    const t = setTimeout(() => setSource({ kind: "text", text: draft }), 400);
    return () => clearTimeout(t);
  }, [draft, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = segments.reduce((a, s) => a + s.duration_s, 0);
  const totalDist = segments.reduce((a, s) => a + (s.distance_m ?? 0), 0);

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="step">1</span> Workout
        </h2>
        <div className="tabs">
          <button className={tab === "text" ? "on" : ""} onClick={() => setTab("text")}>
            Paste steps
          </button>
          <button className={tab === "strava" ? "on" : ""} onClick={() => setTab("strava")}>
            Strava run
          </button>
        </div>
      </div>

      {tab === "text" ? (
        <>
          <textarea
            className="workout-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={"Warm-Up\n0.5mi easy\nSession x3\n1mi at 9:05/mi\n90s walking rest\nCool Down\n0.5mi easy"}
          />
          <p className="hint">
            One step per line: <code>1mi at 9:05/mi</code>, <code>400m at 5:00/km</code>, <code>10 min easy</code>,{" "}
            <code>90s walking rest</code>. Headers like <code>Session x3</code> repeat the steps below them.
          </p>
        </>
      ) : !cfg.stravaConfigured ? (
        <p className="empty">
          Strava isn't set up yet. Add <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code> to{" "}
          <code>backend/.env</code> and restart the backend.
        </p>
      ) : !cfg.stravaConnected ? (
        <div className="empty">
          <p>Import the laps of a run you've finished to build a playlist that matches it.</p>
          <a className="btn strava" href="/api/strava/login">
            Connect Strava
          </a>
        </div>
      ) : (
        <div className="strava-list">
          <label className="check">
            <input type="checkbox" checked={useCadence} onChange={(e) => setUseCadence(e.target.checked)} />
            Use my recorded cadence when the run has it
          </label>
          {stravaError && <p className="error">{stravaError}</p>}
          {!activities && !stravaError && <p className="hint">Loading recent runs…</p>}
          {activities?.length === 0 && <p className="hint">No recent runs found.</p>}
          {activities?.map((a) => (
            <button
              key={a.id}
              className={`activity ${source.kind === "strava" && source.id === a.id ? "on" : ""}`}
              onClick={() => setSource({ kind: "strava", id: a.id, name: a.name, useCadence })}
            >
              <span className="a-name">{a.name}</span>
              <span className="a-meta">
                {new Date(a.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                {distance(a.distance_m, profile.unit)} · {clock(a.moving_time_s)}
              </span>
            </button>
          ))}
        </div>
      )}

      <details className="profile">
        <summary>
          Your running profile <span className="muted">· sets the BPM for each pace</span>
        </summary>
        <div className="profile-grid">
          <label>
            Units
            <select value={profile.unit} onChange={(e) => setProfile({ ...profile, unit: e.target.value as "mi" | "km" })}>
              <option value="mi">miles</option>
              <option value="km">km</option>
            </select>
          </label>
          <PaceInput
            label={`Easy pace (/${profile.unit})`}
            value={profile.easy_pace_s}
            onChange={(v) => setProfile({ ...profile, easy_pace_s: v })}
          />
          <NumInput
            label="Steps/min at easy pace"
            value={profile.easy_cadence}
            onChange={(v) => setProfile({ ...profile, easy_cadence: v })}
          />
          <NumInput
            label={`+ steps/min per min/${profile.unit} faster`}
            value={profile.cadence_gain}
            onChange={(v) => setProfile({ ...profile, cadence_gain: v })}
          />
        </div>
        <p className="hint">
          Not sure? Count your steps for 30 seconds on an easy run and double it. Importing a Strava run with cadence
          uses your real numbers.
        </p>
      </details>

      {error && <p className="error">{error}</p>}
      {segments.length > 0 && (
        <>
          <div className="seg-summary">
            <span>{segments.length} steps</span>
            <span>{clock(total)}</span>
            {totalDist > 0 && <span>{distance(totalDist, profile.unit)}</span>}
          </div>
          <table className="segments">
            <thead>
              <tr>
                <th></th>
                <th>Step</th>
                <th>Time</th>
                <th>Pace</th>
                <th title="Steps per minute = target song BPM">BPM</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s, i) => (
                <tr key={i}>
                  <td>
                    <span className="swatch" style={{ background: segmentColor(s) }} />
                  </td>
                  <td>
                    <div className="seg-label">{s.label}</div>
                    <div className="seg-group">{s.group}</div>
                  </td>
                  <td>{clock(s.duration_s)}</td>
                  <td>{s.kind === "rest" ? "walk" : pace(s.pace_s, profile.unit)}</td>
                  <td>
                    <input
                      className={`bpm-input ${s.cadence_source}`}
                      type="number"
                      value={Math.round(s.cadence)}
                      title={
                        s.cadence_source === "strava"
                          ? "From your Strava cadence"
                          : s.cadence_source === "manual"
                            ? "Set by you"
                            : "Estimated from pace"
                      }
                      onChange={(e) => editSegment(i, { cadence: Number(e.target.value), cadence_source: "manual" })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function PaceInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(clock(value));
  useEffect(() => setText(clock(value)), [value]);
  return (
    <label>
      {label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseClock(text);
          if (v) onChange(v);
          else setText(clock(value));
        }}
      />
    </label>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(e) => e.target.value && onChange(Number(e.target.value))} />
    </label>
  );
}
