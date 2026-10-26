"""Friends (app/routers/friends.py) and inviting friends to a Lounge room
(app/routers/lounge.py). Accounts here are plain make_safe_session_user_id
rows: friends work with no league at all."""
import uuid

from httpx import ASGITransport, AsyncClient

from app import config
from app.auth.session import create_session_token
from app.main import app
from tests.conftest import make_safe_session_user_id

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client(cookies=None):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", cookies=cookies)


async def _person(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    user_id = await make_safe_session_user_id(pool)
    return user_id, {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def test_needs_a_session():
    async with _client() as client:
        assert (await client.get("/friends")).status_code == 401
        assert (await client.get("/lounge/invites")).status_code == 401


async def test_username_rules(pool, monkeypatch):
    _, me = await _person(pool, monkeypatch)
    _, other = await _person(pool, monkeypatch)
    handle = f"tst_{uuid.uuid4().hex[:8]}"
    async with _client(me) as client:
        assert (await client.put("/friends/me/username", json={"username": "a!"})).status_code == 400
        ok = await client.put("/friends/me/username", json={"username": f"@{handle.upper()}"})
        assert ok.status_code == 200 and ok.json()["username"] == handle
        assert (await client.get("/friends/me")).json()["username"] == handle
    async with _client(other) as client:
        assert (await client.put("/friends/me/username", json={"username": handle})).status_code == 409


async def test_request_accept_and_unfriend(pool, monkeypatch):
    a_id, a = await _person(pool, monkeypatch)
    b_id, b = await _person(pool, monkeypatch)
    handle = f"tst_{uuid.uuid4().hex[:8]}"
    async with _client(b) as client:
        await client.put("/friends/me/username", json={"username": handle})
    async with _client(a) as client:
        found = (await client.get("/friends/search", params={"q": handle[:6]})).json()["results"]
        assert any(r["user_id"] == b_id and r["relationship"] == "none" for r in found)
        sent = await client.post("/friends/requests", json={"user_id": b_id})
        assert sent.json()["relationship"] == "outgoing"
        assert [p["user_id"] for p in (await client.get("/friends")).json()["outgoing"]] == [b_id]
        assert (await client.post("/friends/requests", json={"user_id": a_id})).status_code == 400
    async with _client(b) as client:
        assert [p["user_id"] for p in (await client.get("/friends")).json()["incoming"]] == [a_id]
        accepted = await client.post(f"/friends/requests/{a_id}/accept")
        assert accepted.json()["relationship"] == "friends"
    async with _client(a) as client:
        assert [p["user_id"] for p in (await client.get("/friends")).json()["friends"]] == [b_id]
        await client.delete(f"/friends/{b_id}")
        assert (await client.get("/friends")).json() == {"friends": [], "incoming": [], "outgoing": []}


async def test_asking_back_accepts(pool, monkeypatch):
    a_id, a = await _person(pool, monkeypatch)
    b_id, b = await _person(pool, monkeypatch)
    async with _client(a) as client:
        await client.post("/friends/requests", json={"user_id": b_id})
    async with _client(b) as client:
        assert (await client.post("/friends/requests", json={"user_id": a_id})).json()["relationship"] == "friends"


async def test_played_with_lists_league_mates_not_yet_friends(pool, monkeypatch):
    a_id, a = await _person(pool, monkeypatch)
    b_id, _ = await _person(pool, monkeypatch)
    c_id, _ = await _person(pool, monkeypatch)
    async with pool.acquire() as conn:
        league_id = await conn.fetchval(
            "INSERT INTO leagues (name, created_by_user_id, invite_code) VALUES ('Test Friends League', $1, $2) RETURNING id",
            a_id,
            f"test-{uuid.uuid4().hex[:10]}",
        )
        for u in (a_id, b_id):
            await conn.execute(
                "INSERT INTO league_members (league_id, user_id, role) VALUES ($1, $2, 'member')", league_id, u
            )
    try:
        async with _client(a) as client:
            people = (await client.get("/friends/played-with")).json()["people"]
            assert [p["user_id"] for p in people] == [b_id]
            assert people[0]["shared_leagues"] == ["Test Friends League"]
            assert c_id not in [p["user_id"] for p in people]
            await client.post("/friends/requests", json={"user_id": b_id})
            assert (await client.get("/friends/played-with")).json()["people"] == []
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM league_members WHERE league_id = $1", league_id)
            await conn.execute("DELETE FROM leagues WHERE id = $1", league_id)


async def test_invited_friend_joins_lounge_without_password(pool, monkeypatch):
    monkeypatch.setattr(config, "LIVEKIT_API_KEY", "test-key")
    monkeypatch.setattr(config, "LIVEKIT_API_SECRET", "test-secret-livekit")
    monkeypatch.setattr(config, "LIVEKIT_URL", "wss://test.livekit.cloud")
    host_id, host = await _person(pool, monkeypatch)
    friend_id, friend = await _person(pool, monkeypatch)
    stranger_id, stranger = await _person(pool, monkeypatch)
    async with _client(host) as client:
        room = (await client.post("/lounge/rooms", json={"name": "Sunday Watch", "password": "hunter22"})).json()
        # Not friends yet: can't invite.
        assert (await client.post(f"/lounge/rooms/{room['id']}/invites", json={"user_ids": [friend_id]})).status_code == 400
        await client.post("/friends/requests", json={"user_id": friend_id})
    async with _client(friend) as client:
        await client.post(f"/friends/requests/{host_id}/accept")
    async with _client(host) as client:
        resp = await client.post(f"/lounge/rooms/{room['id']}/invites", json={"user_ids": [friend_id, stranger_id]})
        assert resp.json() == {"invited": 1, "new": 1}
        rooms = (await client.get("/lounge/rooms")).json()["rooms"]
        assert [i["user_id"] for i in rooms[0]["invited"]] == [friend_id]
    async with _client(friend) as client:
        invites = (await client.get("/lounge/invites")).json()["invites"]
        assert [i["slug"] for i in invites] == [room["slug"]]
        joined = await client.post(f"/lounge/rooms/{room['slug']}/join", json={})
        assert joined.status_code == 200, joined.text
    async with _client(stranger) as client:
        assert (await client.post(f"/lounge/rooms/{room['slug']}/join", json={})).status_code == 403
    # Unfriending takes the invite with it.
    async with _client(host) as client:
        await client.delete(f"/friends/{friend_id}")
    async with _client(friend) as client:
        assert (await client.get("/lounge/invites")).json()["invites"] == []
