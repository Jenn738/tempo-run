"""Strava login and activity fetches. The token exchange needs the client
secret, which is why this lives on the backend. Tokens are kept in
backend/.data/strava_token.json (git-ignored)."""
from __future__ import annotations

import json
import os
import time
from urllib.parse import urlencode

import httpx

from . import config

TOKEN_PATH = config.DATA_DIR / "strava_token.json"
API = "https://www.strava.com/api/v3"


def configured() -> bool:
    return bool(config.STRAVA_CLIENT_ID and config.STRAVA_CLIENT_SECRET)


def authorize_url() -> str:
    return "https://www.strava.com/oauth/authorize?" + urlencode(
        {
            "client_id": config.STRAVA_CLIENT_ID,
            "redirect_uri": f"{config.BACKEND_URL}/api/strava/callback",
            "response_type": "code",
            "approval_prompt": "auto",
            "scope": "read,activity:read_all",
        }
    )


def _save(tok: dict) -> None:
    TOKEN_PATH.write_text(json.dumps(tok))
    os.chmod(TOKEN_PATH, 0o600)


async def exchange_code(code: str) -> bool:
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
    _save(r.json())
    return True


async def access_token() -> str | None:
    if not configured() or not TOKEN_PATH.exists():
        return None
    tok = json.loads(TOKEN_PATH.read_text())
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
        _save(tok)
    return tok["access_token"]


def disconnect() -> None:
    TOKEN_PATH.unlink(missing_ok=True)


async def get(path: str, token: str, **params) -> tuple[int, object]:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(API + path, params=params, headers={"Authorization": f"Bearer {token}"})
    return r.status_code, r.json()
