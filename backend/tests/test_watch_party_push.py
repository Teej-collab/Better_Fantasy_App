"""Room-start pushes (app/notifications/watch_party_events.py): an open
watch party tells the rest of the league, a private room tells only its
invitees, and both respect push_enabled and the Watch Parties switch."""
import asyncio

from app.notifications import formatter, watch_party_events
from app.queries import owner_preferences


def test_party_payload_opens_the_room_and_names_the_game():
    p = formatter.watch_party_started("Niko", "Niko's watch party", 42, "BUF @ KC")
    assert p["data"]["url"] == "/chat?party=42"
    assert "Niko started a watch party" in p["title"]
    assert "BUF @ KC" in p["body"]
    invite = formatter.watch_party_invite("TJ", "Sunday Sweat", 7)
    assert invite["data"]["url"] == "/chat?party=7"
    assert "invited you" in invite["title"]


def test_invite_push_respects_each_persons_switches(monkeypatch):
    prefs = {
        1: {"push_enabled": True, "notify_watch_parties": True},
        2: {"push_enabled": True, "notify_watch_parties": False},
        3: {"push_enabled": False, "notify_watch_parties": True},
    }
    sent: list[int] = []

    async def fake_prefs(conn, owner_id):
        return prefs[owner_id]

    async def fake_send(conn, owner_id, payload):
        sent.append(owner_id)

    monkeypatch.setattr(owner_preferences, "get_preferences", fake_prefs)
    monkeypatch.setattr(watch_party_events.dispatcher, "send_to_owner", fake_send)

    asyncio.run(watch_party_events.notify_room_invite("TJ", 9, "Sunday Sweat", [1, 2, 3]))

    assert sent == [1]


def test_party_push_skips_the_host(monkeypatch):
    sent: list[int] = []

    class FakeConn:
        async def fetch(self, *_args):
            return [{"owner_id": 1}, {"owner_id": 2}, {"owner_id": 3}]

    class FakeAcquire:
        async def __aenter__(self):
            return FakeConn()

        async def __aexit__(self, *_exc):
            return False

    class FakePool:
        def acquire(self):
            return FakeAcquire()

    async def fake_pool():
        return FakePool()

    async def fake_prefs(conn, owner_id):
        return {"push_enabled": True, "notify_watch_parties": True}

    async def fake_send(conn, owner_id, payload):
        sent.append(owner_id)

    async def no_scoreboard():
        return []

    monkeypatch.setattr(watch_party_events, "get_pool", fake_pool)
    monkeypatch.setattr(watch_party_events, "get_nfl_scoreboard", no_scoreboard)
    monkeypatch.setattr(owner_preferences, "get_preferences", fake_prefs)
    monkeypatch.setattr(watch_party_events.dispatcher, "send_to_owner", fake_send)

    asyncio.run(watch_party_events.notify_party_started(2026, 1, 2, "Niko", 5, "Niko's watch party", "401"))

    assert sent == [1, 3]
