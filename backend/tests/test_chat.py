from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from app import db as db_module
from app.auth.session import create_session_token
from app.main import app
from app.queries import chat as chat_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _use_fresh_pool_for_websocket():
    """
    starlette's TestClient runs the ASGI app on its own event loop in a
    background thread (an anyio blocking portal) — separate from
    pytest-asyncio's loop the rest of this file's tests run on. asyncpg
    pools are bound to the loop they were created on, so the module-level
    singleton in app.db (already created against pytest-asyncio's loop by
    every non-websocket test above) can't be reused here. Clearing it
    forces get_pool() to create a fresh one bound to whichever loop calls
    it next — the websocket handler's thread this time, then back to
    pytest-asyncio's loop for whatever test runs after this one.
    """
    db_module._pool = None


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=999, is_commissioner=False
    )
    return {"session": token}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-chat-owner-{suffix}", f"Chatter {suffix}",
        )


async def _cleanup_messages(pool, *owner_ids):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM messages WHERE owner_id = ANY($1::int[])", list(owner_ids))


async def test_insert_and_list_recent_messages(pool):
    owner_id = await _seed_owner(pool, 1)
    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, owner_id, "hello league")
        await chat_queries.insert_message(conn, owner_id, "second message")
        rows = await chat_queries.list_recent_messages(conn, limit=10)

    await _cleanup_messages(pool, owner_id)

    mine = [r for r in rows if r["owner_id"] == owner_id]
    assert [r["body"] for r in mine] == ["hello league", "second message"]  # oldest first
    assert mine[0]["owner_name"] == "Chatter 1"


async def test_messages_endpoint_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/chat/messages")
    assert resp.status_code == 401


async def test_messages_endpoint_returns_real_history(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 2)
    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, owner_id, "visible in history")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/chat/messages")

    await _cleanup_messages(pool, owner_id)

    assert resp.status_code == 200
    bodies = [m["body"] for m in resp.json()["messages"]]
    assert "visible in history" in bodies


async def test_websocket_rejects_missing_session(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    client = TestClient(app)
    try:
        with client.websocket_connect("/chat/ws"):
            pass
        raised = False
    except Exception:
        raised = True
    assert raised  # server closes with 4401 before completing the handshake normally


async def test_websocket_persists_and_broadcasts_message(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 3)

    _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(owner_id)) as ws:
        ws.send_json({"body": "  live message  "})
        received = ws.receive_json()
    db_module._pool = None  # hand the loop back to pytest-asyncio's tests

    await _cleanup_messages(pool, owner_id)

    assert received["body"] == "live message"  # whitespace trimmed
    assert received["owner_id"] == owner_id
    assert received["owner_name"] == "Chatter 3"
    assert "id" in received and "created_at" in received


async def test_websocket_ignores_blank_and_oversized_messages(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 4)

    _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(owner_id)) as ws:
        ws.send_json({"body": "   "})
        ws.send_json({"body": "x" * 3000})
        ws.send_json({"body": "this one counts"})
        received = ws.receive_json()
    db_module._pool = None

    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT body FROM messages WHERE owner_id = $1", owner_id)
    await _cleanup_messages(pool, owner_id)

    assert received["body"] == "this one counts"
    assert [r["body"] for r in rows] == ["this one counts"]  # the blank/oversized ones never got saved
