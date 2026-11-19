"""Strava login and activity fetches, one login per browser session.

The token exchange needs the client secret, which is why this lives on the
backend. Each visitor gets a random session cookie; their Strava tokens are
stored against it in a small SQLite database in DATA_DIR."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from urllib.parse import urlencode

import httpx

from . import config

API = "https://www.strava.com/api/v3"
DB_PATH = config.DATA_DIR / "tempo_run.db"
_lock = threading.Lock()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS strava_tokens (sid TEXT PRIMARY KEY, token TEXT NOT NULL, updated REAL)"
    )
    return conn


def configured() -> bool:
    return bool(config.STRAVA_CLIENT_ID and config.STRAVA_CLIENT_SECRET)


def authorize_url(state: str) -> str:
    return "https://www.strava.com/oauth/authorize?" + urlencode(
        {
            "client_id": config.STRAVA_CLIENT_ID,
            "redirect_uri": f"{config.BACKEND_URL}/api/strava/callback",
            "response_type": "code",
            "approval_prompt": "auto",
            "scope": "read,activity:read_all",
            "state": state,
        }
    )


def _load(sid: str) -> dict | None:
    with _lock, _db() as conn:
        row = conn.execute("SELECT token FROM strava_tokens WHERE sid = ?", (sid,)).fetchone()
    return json.loads(row[0]) if row else None


def save(sid: str, tok: dict) -> None:
    with _lock, _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO strava_tokens (sid, token, updated) VALUES (?, ?, ?)",
            (sid, json.dumps(tok), time.time()),
        )


def disconnect(sid: str) -> None:
    with _lock, _db() as conn:
        conn.execute("DELETE FROM strava_tokens WHERE sid = ?", (sid,))


async def exchange_code(sid: str, code: str) -> bool:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            "https://www.strava.com/oauth/token",
            data={
                "client_id": config.STRAVA_CLIENT_ID,
                "client_secret": config.STRAVA_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
    if r.status_code != 200:
        return False
    tok = r.json()
    tok.pop("athlete", None)  # don't keep profile details we don't use
    save(sid, tok)
    return True


async def access_token(sid: str | None) -> str | None:
    if not sid or not configured():
        return None
    tok = _load(sid)
    if not tok:
        return None
    if tok.get("expires_at", 0) - 60 < time.time():
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(
                "https://www.strava.com/oauth/token",
                data={
                    "client_id": config.STRAVA_CLIENT_ID,
                    "client_secret": config.STRAVA_CLIENT_SECRET,
                    "grant_type": "refresh_token",
                    "refresh_token": tok["refresh_token"],
                },
            )
        if r.status_code != 200:
            return None
        tok.update(r.json())
        save(sid, tok)
    return tok["access_token"]


async def get(path: str, token: str, **params) -> tuple[int, object]:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(API + path, params=params, headers={"Authorization": f"Bearer {token}"})
    return r.status_code, r.json()
