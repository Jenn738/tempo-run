// Calls to our FastAPI backend (proxied at /api in dev, same origin in prod).
import type { Plan, PlanOptions, RunnerProfile, Segment, StravaActivity, Track } from "./types";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json();
}

export interface AppConfig {
  spotifyClientId: string;
  stravaConfigured: boolean;
  stravaConnected: boolean;
}

export const api = {
  config: () => call<AppConfig>("/api/config"),
  parse: (text: string, profile: RunnerProfile) =>
    call<Segment[]>("/api/workout/parse", { text, profile }),
  recalc: (segments: Segment[], profile: RunnerProfile) =>
    call<Segment[]>("/api/workout/recalc", { segments, profile }),
  stravaActivities: () => call<StravaActivity[]>("/api/strava/activities"),
  stravaSegments: (id: number, profile: RunnerProfile, use_strava_cadence: boolean) =>
    call<Segment[]>(`/api/strava/activities/${id}/segments`, { profile, use_strava_cadence }),
  stravaDisconnect: () => call<{ ok: boolean }>("/api/strava/disconnect", {}),
  tempo: (ids: string[]) =>
    call<Record<string, { tempo: number; energy: number | null } | null>>("/api/tempo", { ids }),
  plan: (segments: Segment[], tracks: Track[], options: PlanOptions) =>
    call<Plan>("/api/plan", { segments, tracks, options }),
};
