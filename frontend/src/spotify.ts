// Spotify Web API, called straight from the browser. Login uses the
// Authorization Code + PKCE flow, so only the app's Client ID is needed.
import type { Track, TrackSource } from "./types";

const SCOPES = [
  "user-read-private",
  "user-library-read",
  "user-top-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

const KEY = "tempo-run.spotify";
const redirectUri = () => `${window.location.origin}/callback`;

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

let clientId = "";
export function setClientId(id: string) {
  clientId = id;
}

function load(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}
function save(t: Tokens | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("tempo-run.verifier", verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export function logout() {
  save(null);
}

export class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The saved login can't be used any more; the user needs to connect again. */
export class LoginExpired extends SpotifyError {
  constructor() {
    super(401, "Your Spotify login expired. Connect again.");
  }
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...body }),
  });
  if (!res.ok) {
    if (body.grant_type === "refresh_token" && (res.status === 400 || res.status === 401)) {
      save(null); // revoked, rotated or otherwise unusable: forget it
      throw new LoginExpired();
    }
    throw new SpotifyError(res.status, `Spotify login failed (${res.status}): ${await res.text()}`);
  }
  const j = await res.json();
  const prev = load();
  const t: Tokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? prev?.refresh_token ?? "",
    expires_at: Date.now() + (j.expires_in - 60) * 1000,
  };
  save(t);
  return t;
}

// Spotify rotates refresh tokens: each one works once. Share a single refresh
// between concurrent callers so a second request doesn't spend a dead token.
let refreshing: Promise<Tokens> | null = null;
function refresh(): Promise<Tokens> {
  const t = load();
  if (!t?.refresh_token) {
    save(null);
    return Promise.reject(new LoginExpired());
  }
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Call on page load: finishes a login redirect if there is one. Runs once
 * even if called twice (React StrictMode), since an auth code works once. */
let redirectResult: Promise<boolean> | null = null;
export function handleRedirect(): Promise<boolean> {
  redirectResult ??= (async () => {
    const url = new URL(window.location.href);
    if (url.pathname !== "/callback") return !!load();
    const code = url.searchParams.get("code");
    const verifier = sessionStorage.getItem("tempo-run.verifier");
    window.history.replaceState({}, "", "/");
    if (!code || !verifier) return false;
    sessionStorage.removeItem("tempo-run.verifier");
    await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });
    return true;
  })();
  return redirectResult;
}

async function token(): Promise<string> {
  let t = load();
  if (!t) throw new LoginExpired();
  if (Date.now() > t.expires_at) t = await refresh();
  return t.access_token;
}

export async function sp<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `https://api.spotify.com/v1${path}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...init.headers },
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") || 2);
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      await refresh(); // access token rejected early: renew once, then retry
      continue;
    }
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).error?.message ?? msg;
      } catch {
        /* empty body */
      }
      throw new SpotifyError(res.status, `Spotify ${res.status}: ${msg} (${path.split("?")[0]})`);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }
  throw new SpotifyError(429, "Spotify is rate limiting; try again in a minute.");
}

// --------------------------------------------------------------- library
export interface Me {
  id: string;
  display_name: string;
  images?: { url: string }[];
}
export const getMe = () => sp<Me>("/me");

function toTrack(t: any, source: TrackSource): Track | null {
  if (!t || t.type !== "track" || !t.id || t.is_local) return null;
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists ?? []).map((a: any) => a.name),
    duration_s: t.duration_ms / 1000,
    image: t.album?.images?.at(-1)?.url ?? t.album?.images?.[0]?.url ?? null,
    source,
  };
}

async function paged(first: string, max: number, onPage?: (n: number) => void): Promise<any[]> {
  const items: any[] = [];
  let next: string | null = first;
  while (next && items.length < max) {
    const page: any = await sp(next);
    items.push(...(page.items ?? []));
    onPage?.(items.length);
    next = page.next;
  }
  return items.slice(0, max);
}

export async function likedSongs(max: number, onProgress?: (n: number) => void): Promise<Track[]> {
  const items = await paged("/me/tracks?limit=50", max, onProgress);
  return items.map((i) => toTrack(i.track, "liked")).filter(Boolean) as Track[];
}

export interface PlaylistSummary {
  id: string;
  name: string;
  total: number;
}

/** Playlists the user made (or collaborates on): not ones they only follow. */
export async function ownPlaylists(me: Me): Promise<PlaylistSummary[]> {
  const items = await paged("/me/playlists?limit=50", 500);
  return items
    .filter((p) => p && (p.owner?.id === me.id || p.collaborative))
    .map((p) => ({ id: p.id, name: p.name, total: p.tracks?.total ?? p.items?.total ?? 0 }));
}

export async function playlistTracks(id: string, max: number): Promise<Track[]> {
  let items: any[];
  try {
    items = await paged(`/playlists/${id}/items?limit=50`, max);
  } catch (e) {
    if (!(e instanceof SpotifyError) || ![403, 404].includes(e.status)) throw e;
    items = await paged(`/playlists/${id}/tracks?limit=50`, max); // older endpoint name
  }
  return items.map((i) => toTrack(i.item ?? i.track, "playlist")).filter(Boolean) as Track[];
}

/** New-to-you songs: tracks by artists you already listen to, plus optional genres. */
export async function discover(library: Track[], genres: string[], perArtist = 10): Promise<Track[]> {
  let artists: string[] = [];
  try {
    const top = await sp("/me/top/artists?limit=15&time_range=medium_term");
    artists = top.items.map((a: any) => a.name);
  } catch {
    /* fall back to library */
  }
  if (artists.length < 5) {
    const counts = new Map<string, number>();
    library.forEach((t) => t.artists.slice(0, 1).forEach((a) => counts.set(a, (counts.get(a) ?? 0) + 1)));
    artists = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([a]) => a);
  }
  const queries = [
    ...artists.map((a) => `artist:"${a}"`),
    ...genres.map((g) => `genre:"${g.trim()}"`),
  ];
  const have = new Set(library.map((t) => t.id));
  const out = new Map<string, Track>();
  for (const q of queries) {
    try {
      const r = await sp(`/search?type=track&limit=${perArtist}&q=${encodeURIComponent(q)}`);
      for (const raw of r.tracks?.items ?? []) {
        const t = toTrack(raw, "new");
        if (t && !have.has(t.id)) out.set(t.id, t);
      }
    } catch (e) {
      if (e instanceof SpotifyError && e.status === 400) {
        // some accounts cap search at 10 results; retry smaller once
        if (perArtist > 10) return discover(library, genres, 10);
      } else throw e;
    }
  }
  return [...out.values()];
}

// --------------------------------------------------------------- playlist out
export async function createPlaylist(me: Me, name: string, description: string, uris: string[]) {
  const body = JSON.stringify({ name, description, public: false });
  let pl: any;
  try {
    pl = await sp("/me/playlists", { method: "POST", body });
  } catch (e) {
    if (!(e instanceof SpotifyError) || ![403, 404, 405].includes(e.status)) throw e;
    pl = await sp(`/users/${encodeURIComponent(me.id)}/playlists`, { method: "POST", body });
  }
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = JSON.stringify({ uris: uris.slice(i, i + 100) });
    try {
      await sp(`/playlists/${pl.id}/items`, { method: "POST", body: chunk });
    } catch (e) {
      if (!(e instanceof SpotifyError) || ![403, 404, 405].includes(e.status)) throw e;
      await sp(`/playlists/${pl.id}/tracks`, { method: "POST", body: chunk });
    }
  }
  return { id: pl.id as string, url: pl.external_urls?.spotify as string };
}
