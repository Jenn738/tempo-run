export interface MusicSettings {
  liked: boolean;
  playlists: boolean;
  discover: boolean;
  genres: string;
}

interface Props {
  settings: MusicSettings;
  setSettings: (s: MusicSettings) => void;
  loading: string | null;
  error: string | null;
  onBuild: () => void;
}

export default function MusicStep({ settings, setSettings, loading, error, onBuild }: Props) {
  const set = (patch: Partial<MusicSettings>) => setSettings({ ...settings, ...patch });
  const none = !settings.liked && !settings.playlists && !settings.discover;
  return (
    <>
      <div className="options">
        <Option checked={settings.liked} onChange={(v) => set({ liked: v })} title="Liked songs" />
        <Option checked={settings.playlists} onChange={(v) => set({ playlists: v })} title="Playlists I made" />
        <Option
          checked={settings.discover}
          onChange={(v) => set({ discover: v })}
          title="New songs"
          sub="By artists you already listen to"
        />
        {settings.discover && (
          <input
            className="genres"
            placeholder="Add genres (optional): pop punk, house…"
            value={settings.genres}
            onChange={(e) => set({ genres: e.target.value })}
          />
        )}
      </div>
      <button className="primary" onClick={onBuild} disabled={!!loading || none}>
        {loading ? "Building…" : "Build my playlist"}
      </button>
      {loading && <p className="quiet progress">{loading}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Option({ checked, onChange, title, sub }: { checked: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return (
    <label className={`option ${checked ? "on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {title}
        {sub && <small>{sub}</small>}
      </span>
    </label>
  );
}
