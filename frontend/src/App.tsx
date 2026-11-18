import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AppConfig } from "./api";
import * as spotify from "./spotify";
import type { Plan, PlanOptions, RunnerProfile, Segment, Track } from "./types";
import WorkoutPanel, { type WorkoutSource } from "./components/WorkoutPanel";
import MusicPanel, { type MusicSettings } from "./components/MusicPanel";
import PlanView from "./components/PlanView";

export const SAMPLE_WORKOUT = `Warm-Up
0.5mi at a conversational pace
No faster than 10:25/mi
Session (2 - 4)
0.5mi at 9:45/mi
1mi at 9:05/mi
1mi at 8:55/mi
90s walking rest
Cool Down
0.5mi at a conversational pace`;

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

const DEFAULT_PROFILE: RunnerProfile = { unit: "mi", easy_pace_s: 630, easy_cadence: 162, cadence_gain: 8, walk_cadence: 115 };
const DEFAULT_OPTIONS: PlanOptions = {
  library_only: false,
  tolerance_pct: 3,
  allow_half_time: true,
  max_tracks_per_block: 4,
  merge_under_s: 150,
  seed: 1,
};
const DEFAULT_MUSIC: MusicSettings = { liked: true, playlists: true, discover: true, genres: "" };

export default function App() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [me, setMe] = useState<spotify.Me | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [profile, setProfile] = useState<RunnerProfile>(() => stored("tempo-run.profile", DEFAULT_PROFILE));
  const [source, setSource] = useState<WorkoutSource>({ kind: "text", text: SAMPLE_WORKOUT });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [workoutError, setWorkoutError] = useState<string | null>(null);

  const [music, setMusic] = useState<MusicSettings>(() => stored("tempo-run.music", DEFAULT_MUSIC));
  const [pool, setPool] = useState<Track[]>([]);
  const [loadingMusic, setLoadingMusic] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);

  const [options, setOptions] = useState<PlanOptions>(() => ({ ...stored("tempo-run.options", DEFAULT_OPTIONS), seed: 1 }));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => store("tempo-run.profile", profile), [profile]);
  useEffect(() => store("tempo-run.music", music), [music]);
  useEffect(() => store("tempo-run.options", options), [options]);

  // boot: config, finish Spotify login, Strava redirect message
  useEffect(() => {
    (async () => {
      try {
        const c = await api.config();
        setCfg(c);
        spotify.setClientId(c.spotifyClientId);
        const params = new URLSearchParams(window.location.search);
        const strava = params.get("strava");
        if (strava) {
          setToast(strava === "connected" ? "Strava connected" : "Strava login didn't finish");
          window.history.replaceState({}, "", "/");
        }
        if (c.spotifyClientId && (await spotify.handleRedirect())) setMe(await spotify.getMe());
      } catch (e) {
        if (e instanceof spotify.SpotifyError && e.status === 403) {
          setFatal(
            "Spotify refused access (403). In development mode, your Spotify account must be added under User Management in your app's dashboard.",
          );
          spotify.logout();
        } else setFatal(String((e as Error).message || e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // workout → segments (re-run when the runner profile changes)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setWorkoutError(null);
        if (source.kind === "text") setSegments(await api.parse(source.text, profile));
        else setSegments(await api.stravaSegments(source.id, profile, source.useCadence));
      } catch (e) {
        setWorkoutError((e as Error).message);
        setSegments([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [source, profile]);

  const editSegment = (i: number, patch: Partial<Segment>) =>
    setSegments((segs) => segs.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  // music pool
  const loadMusic = useCallback(async () => {
    if (!me) return;
    setMusicError(null);
    try {
      const byId = new Map<string, Track>();
      const add = (ts: Track[]) => ts.forEach((t) => !byId.has(t.id) && byId.set(t.id, t));
      if (music.liked) {
        add(await spotify.likedSongs(1500, (n) => setLoadingMusic(`Reading liked songs… ${n}`)));
      }
      if (music.playlists) {
        setLoadingMusic("Finding your playlists…");
        const lists = (await spotify.ownPlaylists(me)).slice(0, 40);
        for (const [i, pl] of lists.entries()) {
          setLoadingMusic(`Reading your playlists… ${i + 1}/${lists.length}: ${pl.name}`);
          try {
            add(await spotify.playlistTracks(pl.id, 400));
          } catch (e) {
            console.warn("Skipped playlist", pl.name, e);
          }
        }
      }
      if (music.discover) {
        setLoadingMusic("Searching Spotify for new songs by artists you like…");
        const genres = music.genres.split(",").map((g) => g.trim()).filter(Boolean);
        add(await spotify.discover([...byId.values()], genres));
      }
      const tracks = [...byId.values()];
      for (let i = 0; i < tracks.length; i += 400) {
        setLoadingMusic(`Looking up BPM… ${Math.min(i + 400, tracks.length)}/${tracks.length}`);
        const tempos = await api.tempo(tracks.slice(i, i + 400).map((t) => t.id));
        for (const t of tracks.slice(i, i + 400)) {
          const f = tempos[t.id];
          if (f) Object.assign(t, { tempo: f.tempo, energy: f.energy });
        }
      }
      setPool(tracks);
    } catch (e) {
      setMusicError((e as Error).message);
    } finally {
      setLoadingMusic(null);
    }
  }, [me, music]);

  // segments + pool + options → plan
  const planReq = useRef(0);
  useEffect(() => {
    if (!segments.length || !pool.length) {
      setPlan(null);
      return;
    }
    const id = ++planReq.current;
    const t = setTimeout(async () => {
      try {
        const p = await api.plan(segments, pool, options);
        if (id === planReq.current) {
          setPlan(p);
          setPlanError(null);
        }
      } catch (e) {
        setPlanError((e as Error).message);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [segments, pool, options]);

  const workoutName = useMemo(() => (source.kind === "strava" ? source.name : "Progression Run"), [source]);

  if (fatal) return <div className="fatal card">{fatal}</div>;
  if (!cfg) return <div className="boot">Loading…</div>;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">♪</span>
          <div>
            <h1>Tempo Run</h1>
            <p>Playlists that match your workout's pace, step by step.</p>
          </div>
        </div>
        <div className="accounts">
          {me ? (
            <button className="pill spotify on" onClick={() => (spotify.logout(), setMe(null), setPool([]))} title="Log out of Spotify">
              ● {me.display_name}
            </button>
          ) : cfg.spotifyClientId ? (
            <button className="pill spotify" onClick={() => spotify.login()}>
              Connect Spotify
            </button>
          ) : (
            <span className="pill warn">Add SPOTIFY_CLIENT_ID to backend/.env</span>
          )}
        </div>
      </header>

      {toast && <div className="toast">{toast}</div>}

      <main className="grid">
        <div className="col">
          <WorkoutPanel
            cfg={cfg}
            source={source}
            setSource={setSource}
            profile={profile}
            setProfile={setProfile}
            segments={segments}
            editSegment={editSegment}
            error={workoutError}
          />
          <MusicPanel
            connected={!!me}
            settings={music}
            setSettings={setMusic}
            pool={pool}
            loading={loadingMusic}
            error={musicError}
            onLoad={loadMusic}
          />
        </div>
        <div className="col wide">
          <PlanView
            me={me}
            plan={plan}
            error={planError}
            segments={segments}
            pool={pool}
            options={options}
            setOptions={setOptions}
            workoutName={workoutName}
            unit={profile.unit}
          />
        </div>
      </main>
    </div>
  );
}
