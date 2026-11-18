import type { Track } from "../types";

export interface MusicSettings {
  liked: boolean;
  playlists: boolean;
  discover: boolean;
  genres: string;
}

interface Props {
  connected: boolean;
  settings: MusicSettings;
  setSettings: (s: MusicSettings) => void;
  pool: Track[];
  loading: string | null;
  error: string | null;
  onLoad: () => void;
}

export default function MusicPanel({ connected, settings, setSettings, pool, loading, error, onLoad }: Props) {
  const count = (src: Track["source"]) => pool.filter((t) => t.source === src).length;
  const withTempo = pool.filter((t) => t.tempo).length;
  const set = (patch: Partial<MusicSettings>) => setSettings({ ...settings, ...patch });

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="step">2</span> Music
        </h2>
      </div>
      {!connected ? (
        <p className="empty">Connect Spotify (top right) to choose from your music.</p>
      ) : (
        <>
          <div className="sources">
            <label className="check">
              <input type="checkbox" checked={settings.liked} onChange={(e) => set({ liked: e.target.checked })} />
              Liked songs
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.playlists} onChange={(e) => set({ playlists: e.target.checked })} />
              Playlists I made
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.discover} onChange={(e) => set({ discover: e.target.checked })} />
              New songs by artists I listen to
            </label>
            {settings.discover && (
              <input
                className="genres"
                placeholder="Optional genres for new songs, e.g. pop punk, house"
                value={settings.genres}
                onChange={(e) => set({ genres: e.target.value })}
              />
            )}
          </div>
          <button className="btn primary" onClick={onLoad} disabled={!!loading || !(settings.liked || settings.playlists || settings.discover)}>
            {loading ? "Loading…" : pool.length ? "Reload music" : "Load my music"}
          </button>
          {loading && <p className="hint progress">{loading}</p>}
          {error && <p className="error">{error}</p>}
          {pool.length > 0 && !loading && (
            <div className="pool-stats">
              <div>
                <b>{count("liked")}</b> liked
              </div>
              <div>
                <b>{count("playlist")}</b> from playlists
              </div>
              <div>
                <b>{count("new")}</b> new
              </div>
              <div>
                <b>{withTempo}</b> with BPM
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
