# Tempo Run

Turn a structured run (a Runna/Strava-style workout, or the laps of a run you
finished on Strava) into a Spotify playlist where **each step gets songs whose
BPM matches your step cadence**, and **the songs add up to that step's length**.
That way the beat speeds up exactly when the workout does.

- **Backend:** Python / FastAPI: workout parsing, Strava login, BPM lookup, song matching
- **Frontend:** React + TypeScript (Vite): Spotify login, timeline, saving the playlist
- **BPM data:** [ReccoBeats](https://reccobeats.com) (free). Spotify stopped giving tempo
  (audio-features) to new developer apps in Nov 2024. Everything else uses the Spotify Web API.

## How it works

1. **Workout → steps.** Paste steps (`0.5mi at 9:45/mi`, `90s walking rest`, `Session x3`…)
   or import a finished Strava run's laps. Each step gets a duration.
2. **Pace → target BPM.** Target BPM = your step cadence. It's estimated from your
   running profile (easy pace, steps/min at easy pace, +steps/min per minute faster),
   or taken from your watch's recorded cadence on Strava runs. You can override any step.
3. **Music pool.** Your liked songs + playlists you made, plus optionally *new* songs
   (Spotify search for artists you listen to, and genres you name). BPM comes from ReccoBeats.
4. **Matching.** For each step it picks 1–4 songs within ±N% of the target BPM
   (half-time counts: an 85 BPM song works for 170 steps/min) whose total length
   best fills the step, carrying any overrun into the next step so the music stays in sync.
   Short steps such as a 90s rest are folded into a neighbouring step.
5. Toggle **My library only** vs **Library + new songs**, shuffle, then **Save to Spotify**.

## One-time setup

### 1. Spotify app (required)
1. Go to <https://developer.spotify.com/dashboard> → **Create app**.
2. **Redirect URIs:** add both
   - `http://127.0.0.1:5173/callback` (dev)
   - `http://127.0.0.1:8000/callback` (built app served by the backend)
   Spotify requires `127.0.0.1`, not `localhost`.
3. **APIs used:** tick **Web API**.
4. In **User Management**, add the email of every Spotify account that will log in
   (apps in development mode only work for listed users).
5. Copy the **Client ID**. No client secret is needed (the app logs in with PKCE).

### 2. Strava app (optional, for importing runs)
Strava requires a **Strava subscription** on the account that registers the API app.

1. Go to <https://www.strava.com/settings/api> and create an app.
2. **Authorization Callback Domain:** `127.0.0.1`
3. Copy the **Client ID** and **Client Secret**.

### 3. Configure
```bash
cp backend/.env.example backend/.env
# then fill in SPOTIFY_CLIENT_ID (and STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET)
```

### 4. Install
```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..
```

## Run (development)
Two terminals:
```bash
cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
```bash
cd frontend && npm run dev
```
Open <http://127.0.0.1:5173>.

## Build
```bash
cd frontend && npm run build
```
The backend then serves the built app too: run uvicorn and open <http://127.0.0.1:8000>.

## Tests
```bash
cd backend && .venv/bin/python -m pytest
```
```bash
cd frontend && npm run typecheck
```

## Hosting (you + friends)

The app ships as one container (`Dockerfile`): the FastAPI backend serves the
API *and* the built frontend, so it deploys as a single service on any host that
runs Docker from a GitHub repo (Render, Railway, Fly.io…).

1. **Deploy** the repo with its `Dockerfile`. Attach a small **persistent volume
   at `/data`**; it holds Strava logins and the BPM cache.
2. **Environment variables** on the host:
   ```
   SPOTIFY_CLIENT_ID=...
   STRAVA_CLIENT_ID=...
   STRAVA_CLIENT_SECRET=...
   FRONTEND_URL=https://run.yoursite.com
   BACKEND_URL=https://run.yoursite.com
   ```
3. **Domain:** add a CNAME for `run.yoursite.com` pointing at the host; it issues HTTPS.
4. **Spotify dashboard:** add redirect URI `https://run.yoursite.com/callback`, and
   add each friend's Spotify email under **User Management** (development-mode
   apps only work for listed accounts).
5. **Strava settings:** set the Authorization Callback Domain to `run.yoursite.com`.

Each browser gets its own session cookie, so every friend connects their own
Strava; Spotify logins stay in each person's browser.

## Tips & limits
- **Play in order with shuffle off.** Spotify can't cut songs, so step boundaries
  land within roughly ±20–60s; the app shows how far each step's music ends from the step's end.
- A bigger library gives tighter matches. If a step says "Few close matches", turn on
  new songs, add genres, or widen the BPM range.
- Not sure of your cadence? Count steps for 30s on an easy run and double it,
  or import a Strava run recorded with a watch.
- Strava's API only has **completed** activities; planned workouts (e.g. from Runna)
  aren't available through it, so paste those as text.
