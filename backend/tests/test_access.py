from fastapi.testclient import TestClient

from app import access, config
from app.main import app


def test_request_is_posted_to_discord(monkeypatch):
    sent = []

    async def fake_send(email, name):
        sent.append((email, name))
        return True

    monkeypatch.setattr(config, "DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/x")
    monkeypatch.setattr(access, "send", fake_send)
    c = TestClient(app)
    assert c.get("/api/config").json()["accessRequests"] is True
    r = c.post("/api/access-request", json={"email": "friend@example.com", "name": "Sam"})
    assert r.status_code == 200 and sent == [("friend@example.com", "Sam")]


def test_rejects_bad_email_and_rate_limits(monkeypatch):
    async def fake_send(email, name):
        return True

    monkeypatch.setattr(config, "DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/x")
    monkeypatch.setattr(access, "send", fake_send)
    c = TestClient(app)
    assert c.post("/api/access-request", json={"email": "not-an-email"}).status_code == 422
    codes = [c.post("/api/access-request", json={"email": "a@b.co"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_disabled_without_webhook(monkeypatch):
    monkeypatch.setattr(config, "DISCORD_WEBHOOK_URL", "")
    c = TestClient(app)
    assert c.post("/api/access-request", json={"email": "a@b.co"}).status_code == 503


def test_user_text_cannot_ping_or_format():
    assert access._plain("@everyone **hi**") == "\\@everyone \\*\\*hi\\*\\*"
