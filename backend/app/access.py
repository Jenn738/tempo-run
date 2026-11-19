"""Friends ask to be added to the Spotify app's allowlist; the request is
posted to the owner's Discord channel via a webhook."""
from __future__ import annotations

import re
import time
from collections import defaultdict, deque

import httpx

from . import config

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
MAX_PER_HOUR = 3
_recent: dict[str, deque] = defaultdict(deque)


def enabled() -> bool:
    return config.DISCORD_WEBHOOK_URL.startswith("https://")


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email)) and len(email) <= 254


def allow(key: str) -> bool:
    """At most MAX_PER_HOUR requests per session, so the channel can't be spammed."""
    now, q = time.time(), _recent[key]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= MAX_PER_HOUR:
        return False
    q.append(now)
    return True


def _plain(text: str) -> str:
    # keep user text from turning into Discord formatting or links
    return re.sub(r"([\\*_~`|>\[\]()#@:-])", r"\\\1", text)


async def send(email: str, name: str) -> bool:
    who = f" ({_plain(name)})" if name else ""
    content = (
        f"**Tempo Run access request**\n"
        f"Spotify email: `{email.replace('`', '')}`{who}\n"
        f"Add it under Spotify Developer Dashboard → your app → User Management."
    )
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            config.DISCORD_WEBHOOK_URL,
            json={"content": content, "allowed_mentions": {"parse": []}, "username": "Tempo Run"},
        )
    return r.status_code in (200, 204)
