import time
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from app import strava
from app.main import SESSION_COOKIE, STATE_COOKIE, app


def test_each_browser_gets_its_own_strava_login():
    me, friend = TestClient(app), TestClient(app)
    assert me.get("/api/config").json()["stravaConnected"] is False
    friend.get("/api/config")
    my_sid, friend_sid = me.cookies[SESSION_COOKIE], friend.cookies[SESSION_COOKIE]
    assert my_sid != friend_sid

    strava.save(my_sid, {"access_token": "mine", "refresh_token": "r", "expires_at": time.time() + 3600})
    assert me.get("/api/config").json()["stravaConnected"] is True
    assert friend.get("/api/config").json()["stravaConnected"] is False
    assert friend.get("/api/strava/activities").status_code == 401

    me.post("/api/strava/disconnect")
    assert me.get("/api/config").json()["stravaConnected"] is False


def test_strava_callback_rejects_mismatched_state():
    c = TestClient(app, follow_redirects=False)
    r = c.get("/api/strava/login")
    assert r.status_code == 307
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    assert c.cookies[STATE_COOKIE] == state

    bad = c.get("/api/strava/callback", params={"code": "x", "state": "forged"})
    assert bad.headers["location"].endswith("?strava=error")
