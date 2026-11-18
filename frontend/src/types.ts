export type Unit = "mi" | "km";

export interface RunnerProfile {
  unit: Unit;
  easy_pace_s: number;
  easy_cadence: number;
  cadence_gain: number;
  walk_cadence: number;
}

export interface Segment {
  label: string;
  kind: "run" | "rest";
  group: string;
  duration_s: number;
  distance_m?: number | null;
  pace_s?: number | null;
  cadence: number;
  cadence_source: "pace" | "strava" | "manual";
  intensity: number;
}

export type TrackSource = "liked" | "playlist" | "new";

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  duration_s: number;
  tempo?: number | null;
  energy?: number | null;
  image?: string | null;
  source: TrackSource;
}

export interface PlanOptions {
  library_only: boolean;
  tolerance_pct: number;
  allow_half_time: boolean;
  max_tracks_per_block: number;
  merge_under_s: number;
  seed: number;
}

export interface Pick {
  track: Track;
  effective_bpm: number;
  multiplier: number;
  bpm_off_pct: number;
  starts_at_s: number;
}

export interface Block {
  label: string;
  group: string;
  segment_indices: number[];
  start_s: number;
  duration_s: number;
  target_bpm: number;
  picks: Pick[];
  music_s: number;
  drift_end_s: number;
  tolerance_used_pct: number;
  note?: string | null;
}

export interface Plan {
  blocks: Block[];
  total_workout_s: number;
  total_music_s: number;
  pool_size: number;
  tempo_known: number;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  date: string;
  distance_m: number;
  moving_time_s: number;
}
