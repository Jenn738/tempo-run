import { useEffect, useState } from "react";
import { api } from "../api";
import { clock, distance, parseClock } from "../format";
import type { RunnerProfile, Segment, StravaActivity } from "../types";
import Bars from "./Bars";

export type WorkoutSource =
  | { kind: "text"; text: string }
  | { kind: "strava"; id: number; name: string };

export type ProfileOrigin = { kind: "default" } | { kind: "strava"; runs: number } | { kind: "manual" };

interface Props {
  stravaConnected: boolean;
  source: WorkoutSource;
  setSource: (s: WorkoutSource) => void;
  segments: Segment[];
  editSegment: (i: number, patch: Partial<Segment>) => void;
  profile: RunnerProfile;
  setProfile: (p: RunnerProfile) => void;
  profileOrigin: ProfileOrigin;
  error: string | null;
  onContinue: () => void;
}

const EXAMPLE = `Warm-Up
0.5mi at a conversational pace
Session
0.5mi at 9:45/mi
1mi at 9:05/mi
1mi at 8:55/mi
90s walking rest
Cool Down
0.5mi at a conversational pace`;

export default function WorkoutStep(p: Props) {
  const [mode, setMode] = useState<"text" | "strava">(p.source.kind);
  const [draft, setDraft] = useState(p.source.kind === "text" ? p.source.text : "");
  const [activities, setActivities] = useState<StravaActivity[] | null>(null);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [showFormat, setShowFormat] = useState(false);

  useEffect(() => {
    if (mode !== "strava" || !p.stravaConnected || activities) return;
    api
      .stravaActivities()
      .then((a) => setActivities(a.filter((x) => /run/i.test(x.type))))
      .catch((e) => setStravaError(e.message));
  }, [mode, p.stravaConnected, activities]);

  useEffect(() => {
    if (mode !== "text") return;
    const t = setTimeout(() => p.setSource({ kind: "text", text: draft }), 350);
    return () => clearTimeout(t);
  }, [draft, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = p.segments.reduce((a, s) => a + s.duration_s, 0);
  const dist = p.segments.reduce((a, s) => a + (s.distance_m ?? 0), 0);

  return (
    <>
      <div className="switch" role="tablist">
        <button className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>
          Type or paste
        </button>
        <button className={mode === "strava" ? "on" : ""} onClick={() => setMode("strava")}>
          From Strava
        </button>
      </div>

      {mode === "text" ? (
        <div className="paste">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={"Paste your workout steps, e.g.\n0.5mi easy\n1mi at 9:05/mi\n90s walking rest"}
          />
          <div className="paste-foot">
            <button className="link" onClick={() => setShowFormat((v) => !v)} aria-expanded={showFormat}>
              {showFormat ? "Hide format" : "Format"}
            </button>
            {!draft && (
              <button className="link" onClick={() => setDraft(EXAMPLE)}>
                Use an example
              </button>
            )}
          </div>
          {showFormat && <FormatHelp />}
        </div>
      ) : !p.stravaConnected ? (
        <p className="quiet">Connect Strava in step 1 to pick one of your runs.</p>
      ) : (
        <div className="runs">
          {stravaError && <p className="error">{stravaError}</p>}
          {!activities && !stravaError && <p className="quiet">Loading your runs…</p>}
          {activities?.length === 0 && <p className="quiet">No recent runs found.</p>}
          {activities?.slice(0, 12).map((a) => (
            <button
              key={a.id}
              className={`run ${p.source.kind === "strava" && p.source.id === a.id ? "on" : ""}`}
              onClick={() => p.setSource({ kind: "strava", id: a.id, name: a.name })}
            >
              <span>{a.name}</span>
              <span className="quiet">
                {new Date(a.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                {distance(a.distance_m, p.profile.unit)} · {clock(a.moving_time_s)}
              </span>
            </button>
          ))}
        </div>
      )}

      {p.error && draft && <p className="error">{p.error}</p>}

      {p.segments.length > 0 && (
        <>
          <div className="totals">
            <b>{clock(total)}</b>
            {dist > 0 && <span>{distance(dist, p.profile.unit)}</span>}
            <span>{p.segments.length} steps</span>
          </div>
          <Bars segments={p.segments} />

          <details className="finetune">
            <summary>Fine-tune BPM</summary>
            <FineTune {...p} />
          </details>

          <button className="primary" onClick={p.onContinue}>
            Continue
          </button>
        </>
      )}
    </>
  );
}

function FormatHelp() {
  return (
    <div className="cheat">
      <dl>
        <dt>Step</dt>
        <dd>
          <code>1mi at 9:05/mi</code> <code>400m at 5:00/km</code> <code>10 min at 8:30/mi</code>
        </dd>
        <dt>Easy</dt>
        <dd>
          <code>0.5mi easy</code> <code>10 min easy</code>
        </dd>
        <dt>Rest</dt>
        <dd>
          <code>90s walking rest</code> <code>2 min rest</code>
        </dd>
        <dt>Sections</dt>
        <dd>
          <code>Warm-Up</code> <code>Session x3</code> <code>Cool Down</code>
        </dd>
      </dl>
      <p>One step per line. A section like “Session x3” repeats the steps under it. Copied Runna workouts work as they are.</p>
    </div>
  );
}

function FineTune({ profile, setProfile, profileOrigin, segments, editSegment }: Props) {
  const origin =
    profileOrigin.kind === "strava"
      ? `Estimated from your last ${profileOrigin.runs} Strava runs.`
      : profileOrigin.kind === "manual"
        ? "Set by you."
        : "Typical values. Connect Strava to use your own.";
  return (
    <div className="ft">
      <p className="quiet">
        Each step's BPM is your steps per minute at that pace. {origin}
      </p>
      <div className="ft-grid">
        <label>
          Units
          <select value={profile.unit} onChange={(e) => setProfile({ ...profile, unit: e.target.value as "mi" | "km" })}>
            <option value="mi">miles</option>
            <option value="km">km</option>
          </select>
        </label>
        <PaceInput
          label={`Easy pace /${profile.unit}`}
          value={profile.easy_pace_s}
          onChange={(v) => setProfile({ ...profile, easy_pace_s: v })}
        />
        <label>
          Steps/min when easy
          <input
            type="number"
            value={profile.easy_cadence}
            onChange={(e) => e.target.value && setProfile({ ...profile, easy_cadence: Number(e.target.value) })}
          />
        </label>
        <label>
          + per min/{profile.unit} faster
          <input
            type="number"
            value={profile.cadence_gain}
            onChange={(e) => e.target.value && setProfile({ ...profile, cadence_gain: Number(e.target.value) })}
          />
        </label>
      </div>
      <table className="ft-steps">
        <tbody>
          {segments.map((s, i) => (
            <tr key={i}>
              <td>{s.label}</td>
              <td className="quiet">{clock(s.duration_s)}</td>
              <td>
                <input
                  type="number"
                  value={Math.round(s.cadence)}
                  onChange={(e) => editSegment(i, { cadence: Number(e.target.value), cadence_source: "manual" })}
                />{" "}
                <span className="quiet">BPM</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
