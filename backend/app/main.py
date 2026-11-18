from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, strava, tempo
from .matcher import Plan, PlanOptions, Track, plan_playlist
from .workout import RunnerProfile, Segment, finalize, parse_workout_text, segments_from_laps

app = FastAPI(title="Tempo Run")


@app.get("/api/config")
async def get_config():
    return {
        "spotifyClientId": config.SPOTIFY_CLIENT_ID,
        "stravaConfigured": strava.configured(),
        "stravaConnected": (await strava.access_token()) is not None,
    }


# ------------------------------------------------------------------ workout
class ParseRequest(BaseModel):
    text: str
    profile: RunnerProfile = RunnerProfile()


@app.post("/api/workout/parse", response_model=list[Segment])
def parse(req: ParseRequest):
    segs = parse_workout_text(req.text, req.profile)
    if not segs:
        raise HTTPException(422, "Couldn't find any steps. Try lines like '1mi at 9:05/mi'.")
    return segs


class RecalcRequest(BaseModel):
    segments: list[Segment]
    profile: RunnerProfile = RunnerProfile()


@app.post("/api/workout/recalc", response_model=list[Segment])
def recalc(req: RecalcRequest):
    """Recompute cadences after the runner profile changes (keeps manual/Strava ones)."""
    return finalize(req.segments, req.profile)


# ------------------------------------------------------------------ strava
@app.get("/api/strava/login")
def strava_login():
    if not strava.configured():
        raise HTTPException(400, "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to backend/.env")
    return RedirectResponse(strava.authorize_url())


@app.get("/api/strava/callback")
async def strava_callback(code: str | None = None, error: str | None = None):
    ok = bool(code) and await strava.exchange_code(code)
    return RedirectResponse(f"{config.FRONTEND_URL}/?strava={'connected' if ok else 'error'}")


@app.post("/api/strava/disconnect")
def strava_disconnect():
    strava.disconnect()
    return {"ok": True}


async def _token() -> str:
    tok = await strava.access_token()
    if not tok:
        raise HTTPException(401, "Strava isn't connected")
    return tok


@app.get("/api/strava/activities")
async def strava_activities():
    status, data = await strava.get("/athlete/activities", await _token(), per_page=30)
    if status != 200:
        raise HTTPException(status, data)
    return [
        {
            "id": a["id"],
            "name": a["name"],
            "type": a.get("sport_type") or a.get("type"),
            "date": a.get("start_date_local"),
            "distance_m": a.get("distance"),
            "moving_time_s": a.get("moving_time"),
        }
        for a in data
    ]


class LapsRequest(BaseModel):
    profile: RunnerProfile = RunnerProfile()
    use_strava_cadence: bool = True


@app.post("/api/strava/activities/{activity_id}/segments", response_model=list[Segment])
async def strava_segments(activity_id: int, req: LapsRequest):
    status, laps = await strava.get(f"/activities/{activity_id}/laps", await _token())
    if status != 200:
        raise HTTPException(status, laps)
    return segments_from_laps(laps, req.profile, req.use_strava_cadence)


# ------------------------------------------------------------------ music
class TempoRequest(BaseModel):
    ids: list[str]


@app.post("/api/tempo")
async def get_tempo(req: TempoRequest):
    return await tempo.lookup(req.ids[:2000])


class PlanRequest(BaseModel):
    segments: list[Segment]
    tracks: list[Track]
    options: PlanOptions = PlanOptions()


@app.post("/api/plan", response_model=Plan)
def make_plan(req: PlanRequest):
    if not req.segments:
        raise HTTPException(422, "Add a workout first")
    return plan_playlist(req.segments, req.tracks, req.options)


# ------------------------------------------------------------------ built frontend
if config.FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        return FileResponse(config.FRONTEND_DIST / "index.html")
