"""Song tempo (BPM) and energy from ReccoBeats, keyed by Spotify track ID.

Spotify stopped serving tempo (audio-features) to new developer apps in
Nov 2024; ReccoBeats offers the same numbers for free. Results are cached on
disk so a library only gets looked up once."""
from __future__ import annotations

import asyncio
import json
import threading

import httpx

from .config import DATA_DIR

API = "https://api.reccobeats.com/v1/audio-features"
BATCH = 40  # ReccoBeats' per-request limit
CACHE_PATH = DATA_DIR / "tempo_cache.json"
_lock = threading.Lock()


def _load() -> dict:
    try:
        return json.loads(CACHE_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


_cache: dict[str, dict | None] = _load()


def _save() -> None:
    with _lock:
        CACHE_PATH.write_text(json.dumps(_cache))


async def _fetch(client: httpx.AsyncClient, ids: list[str]) -> dict[str, dict]:
    for attempt in range(3):
        r = await client.get(API, params={"ids": ",".join(ids)})
        if r.status_code == 429:
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code != 200:
            return {}
        out = {}
        for f in r.json().get("content", []):
            sid = (f.get("href") or "").rstrip("/").rsplit("/", 1)[-1]
            if sid and f.get("tempo"):
                out[sid] = {"tempo": round(f["tempo"], 1), "energy": f.get("energy")}
        return out
    return {}


async def lookup(ids: list[str]) -> dict[str, dict | None]:
    ids = list(dict.fromkeys(i for i in ids if i))
    missing = [i for i in ids if i not in _cache]
    if missing:
        sem = asyncio.Semaphore(4)
        async with httpx.AsyncClient(timeout=20, headers={"Accept": "application/json"}) as client:

            async def run(chunk):
                async with sem:
                    return chunk, await _fetch(client, chunk)

            results = await asyncio.gather(
                *(run(missing[i : i + BATCH]) for i in range(0, len(missing), BATCH))
            )
        for chunk, found in results:
            for sid in chunk:
                _cache[sid] = found.get(sid)  # None = ReccoBeats doesn't know it
        _save()
    return {i: _cache.get(i) for i in ids}
