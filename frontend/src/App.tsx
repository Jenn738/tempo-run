import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type AppConfig } from "./api";
import * as spotify from "./spotify";
import { clock, distance } from "./format";
import type { Plan, PlanOptions, RunnerProfile, Segment, Track } from "./types";
import Step from "./components/Step";
import WorkoutStep, { type ProfileOrigin, type WorkoutSource } from "./components/WorkoutStep";
import MusicStep, { type MusicSettings } from "./components/MusicStep";
import PlaylistStep from "./components/PlaylistStep";
import Logo from "./components/Logo";
import { SpotifyIcon, StravaIcon } from "./components/BrandIcons";

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
    /* storage unavailable */
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
const DEFAULT_MUSIC: MusicSettings = { liked: true, playlists: true, discover: false, genres: "" };

enum S {
  Accounts,
  Workout,
  Music,
  Playlist,
}

export default function App() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [me, setMe] = useState<spotify.Me | null>(null);
  const [active, setActive] = useState<S>(S.Accounts);
  const [reached, setReached] = useState<S>(S.Accounts);
  const go = (s: S) => {
    setActive(s);
    setReached((r) => Math.max(r, s));
  };

  const [profile, setProfileRaw] = useState<RunnerProfile>(() => stored("tempo-run.profile", DEFAULT_PROFILE));
  const [profileOrigin, setProfileOrigin] = useState<ProfileOrigin>(() =>
    stored("tempo-run.profileOrigin", { kind: "default" } as ProfileOrigin),
  );
  const setProfile = (p: RunnerProfile) => {
    setProfileRaw(p);
    setProfileOrigin({ kind: "manual" });
  };
  const [source, setSource] = useState<WorkoutSource>({ kind: "text", text: "" });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [workoutError, setWorkoutError] = useState<string | null>(null);

  const [music, setMusic] = useState<MusicSettings>(() => stored("tempo-run.music", DEFAULT_MUSIC));
  const [pool, setPool] = useState<Track[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);

  const [options, setOptions] = useState<PlanOptions>(() => ({ ...stored("tempo-run.options", DEFAULT_OPTIONS), seed: 1 }));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => store("tempo-run.profile", profile), [profile]);
  useEffect(() => store("tempo-run.profileOrigin", profileOrigin), [profileOrigin]);
  useEffect(() => store("tempo-run.music", music), [music]);
  useEffect(() => store("tempo-run.options", options), [options]);

  // boot: config, finish Spotify login, Strava redirect
  useEffect(() => {
    (async () => {
      try {
        const c = await api.config();
        setCfg(c);
        spotify.setClientId(c.spotifyClientId);
        if (new URLSearchParams(window.location.search).has("strava")) window.history.replaceState({}, "", "/");
        if (c.spotifyClientId && (await spotify.handleRedirect())) {
          setMe(await spotify.getMe());
          go(S.Workout);
        }
      } catch (e) {
        if (e instanceof spotify.SpotifyError && e.status === 403) {
          spotify.logout();
          setFatal(
            "Spotify said this account isn't allowed yet. Add your Spotify email under User Management in your app on developer.spotify.com, then reload.",
          );
        } else setFatal((e as Error).message);
      }
    })();
  }, []);

  // Personal BPM profile from recent Strava runs (unless the runner set it by hand)
  useEffect(() => {
    if (!cfg?.stravaConnected || profileOrigin.kind === "manual") return;
    api
      .stravaProfile(profile.unit)
      .then(({ profile: p, runs_used }) => {
        if (runs_used >= 3) {
          setProfileRaw({ ...p, walk_cadence: profile.walk_cadence });
          setProfileOrigin({ kind: "strava", runs: runs_used });
        }
      })
      .catch(() => {});
  }, [cfg?.stravaConnected, profile.unit]); // eslint-disable-line react-hooks/exhaustive-deps

  // workout → steps
  useEffect(() => {
    if (source.kind === "text" && !source.text.trim()) {
      setSegments([]);
      setWorkoutError(null);
      return;
    }
    let stale = false;
    (async () => {
      try {
        const segs =
          source.kind === "text"
            ? await api.parse(source.text, profile)
            : await api.stravaSegments(source.id, profile, profileOrigin.kind !== "manual");
        if (!stale) {
          setSegments(segs);
          setWorkoutError(null);
        }
      } catch (e) {
        if (!stale) {
          setWorkoutError((e as Error).message);
          setSegments([]);
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [source, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const editSegment = (i: number, patch: Partial<Segment>) =>
    setSegments((segs) => segs.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  // music → pool (with BPM)
  const build = useCallback(async () => {
    if (!me) return;
    setMusicError(null);
    try {
      const byId = new Map<string, Track>();
      const add = (ts: Track[]) => ts.forEach((t) => !byId.has(t.id) && byId.set(t.id, t));
      if (music.liked) add(await spotify.likedSongs(1500, (n) => setLoading(`Reading your liked songs… ${n}`)));
      if (music.playlists) {
        setLoading("Finding your playlists…");
        const lists = (await spotify.ownPlaylists(me)).slice(0, 40);
        for (const [i, pl] of lists.entries()) {
          setLoading(`Reading your playlists… ${i + 1} of ${lists.length}`);
          try {
            add(await spotify.playlistTracks(pl.id, 400));
          } catch (e) {
            console.warn("Skipped playlist", pl.name, e);
          }
        }
      }
      if (music.discover) {
        setLoading("Finding new songs…");
        const genres = music.genres.split(",").map((g) => g.trim()).filter(Boolean);
        add(await spotify.discover([...byId.values()], genres));
      }
      const tracks = [...byId.values()];
      if (!tracks.length) throw new Error("No songs found in the sources you picked.");
      for (let i = 0; i < tracks.length; i += 400) {
        setLoading(`Checking song tempos… ${Math.min(i + 400, tracks.length)} of ${tracks.length}`);
        const tempos = await api.tempo(tracks.slice(i, i + 400).map((t) => t.id));
        for (const t of tracks.slice(i, i + 400)) {
          const f = tempos[t.id];
          if (f) Object.assign(t, { tempo: f.tempo, energy: f.energy });
        }
      }
      setPool(tracks);
      setOptions((o) => ({ ...o, library_only: !music.discover }));
      go(S.Playlist);
    } catch (e) {
      setMusicError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }, [me, music]);

  // steps + pool + options → plan
  const req = useRef(0);
  useEffect(() => {
    if (!segments.length || !pool.length) return setPlan(null);
    const id = ++req.current;
    const t = setTimeout(async () => {
      try {
        const p = await api.plan(segments, pool, options);
        if (id === req.current) {
          setPlan(p);
          setPlanError(null);
        }
      } catch (e) {
        setPlanError((e as Error).message);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [segments, pool, options]);

  if (fatal) return <div className="page"><p className="error card-ish">{fatal}</p></div>;
  if (!cfg) return <div className="page quiet">Loading…</div>;

  const totalS = segments.reduce((a, s) => a + s.duration_s, 0);
  const totalM = segments.reduce((a, s) => a + (s.distance_m ?? 0), 0);
  const workoutName =
    source.kind === "strava" ? source.name : `${distance(totalM, profile.unit) || clock(totalS)} run`;
  const sources = [music.liked && "liked songs", music.playlists && "your playlists", music.discover && "new songs"]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="page">
      <header className="hero">
        <Logo />
        <p>Convert your workout into a playlist whose beat matches every step of your run</p>
      </header>

      <Step
        n={1}
        title="Connect"
        active={active === S.Accounts}
        done={!!me}
        summary={["Spotify", cfg.stravaConnected && "Strava"].filter(Boolean).join(" · ")}
        onEdit={() => setActive(S.Accounts)}
      >
        <div className="accounts">
          <Account
            icon={<SpotifyIcon />}
            name="Spotify"
            required
            hint="Reads your music and saves the playlist"
            connected={me ? me.display_name : null}
            action={
              me ? (
                <button className="secondary small" onClick={() => (spotify.logout(), setMe(null), setPool([]))}>
                  Disconnect
                </button>
              ) : (
                <button
                  className="spotify small"
                  disabled={!cfg.spotifyClientId}
                  title={cfg.spotifyClientId ? undefined : "Needs SPOTIFY_CLIENT_ID in backend/.env"}
                  onClick={() => spotify.login()}
                >
                  Connect
                </button>
              )
            }
          />
          <Account
            icon={<StravaIcon />}
            name="Strava"
            hint="Import runs and personalise your BPM"
            connected={cfg.stravaConnected ? "Connected" : null}
            action={
              cfg.stravaConnected ? (
                <button
                  className="secondary small"
                  onClick={async () => {
                    await api.stravaDisconnect();
                    setCfg({ ...cfg, stravaConnected: false });
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="strava small"
                  disabled={!cfg.stravaConfigured}
                  title={cfg.stravaConfigured ? undefined : "Needs one-time Strava app setup (see README)"}
                  onClick={() => (window.location.href = "/api/strava/login")}
                >
                  Connect
                </button>
              )
            }
          />
        </div>
        <button className="primary" disabled={!me} onClick={() => go(S.Workout)}>
          Continue
        </button>
      </Step>

      {reached >= S.Workout && (
        <Step
          n={2}
          title="Workout"
          active={active === S.Workout}
          done={segments.length > 0}
          summary={segments.length ? `${workoutName} · ${clock(totalS)} · ${segments.length} steps` : "Not set"}
          onEdit={() => setActive(S.Workout)}
        >
          <WorkoutStep
            stravaConnected={cfg.stravaConnected}
            source={source}
            setSource={setSource}
            segments={segments}
            editSegment={editSegment}
            profile={profile}
            setProfile={setProfile}
            profileOrigin={profileOrigin}
            error={workoutError}
            onContinue={() => go(reached >= S.Playlist ? S.Playlist : S.Music)}
          />
        </Step>
      )}

      {reached >= S.Music && (
        <Step
          n={3}
          title="Music"
          active={active === S.Music}
          done={pool.length > 0}
          summary={pool.length ? `${pool.length} songs from ${sources}` : sources}
          onEdit={() => setActive(S.Music)}
        >
          <MusicStep settings={music} setSettings={setMusic} loading={loading} error={musicError} onBuild={build} />
        </Step>
      )}

      {reached >= S.Playlist && me && (
        <Step
          n={4}
          title="Your playlist"
          active={active === S.Playlist}
          done={!!plan}
          summary={plan ? `${plan.blocks.reduce((a, b) => a + b.picks.length, 0)} songs` : ""}
          onEdit={() => setActive(S.Playlist)}
        >
          <PlaylistStep
            me={me}
            plan={plan}
            error={planError}
            segments={segments}
            pool={pool}
            options={options}
            setOptions={setOptions}
            workoutName={workoutName}
          />
        </Step>
      )}
    </div>
  );
}

function Account(props: {
  icon: ReactNode;
  name: string;
  hint: string;
  required?: boolean;
  connected: string | null;
  action: ReactNode;
}) {
  return (
    <div className={`account ${props.connected ? "on" : ""}`}>
      {props.icon}
      <div className="acct-text">
        <div className="acct-name">
          {props.name}
          {props.required && (
            <span className="req" title="Required">
              *
            </span>
          )}
          {props.connected && <span className="acct-status">● {props.connected}</span>}
        </div>
        <div className="quiet">{props.hint}</div>
      </div>
      {props.action}
    </div>
  );
}
