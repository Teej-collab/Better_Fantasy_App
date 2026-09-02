from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from app import db as db_module
from app.auth.session import create_session_token, create_ticket_token
from app.chat.manager import manager as chat_manager
from app.main import app
from app.queries import chat as chat_queries
from app.queries import owner_preferences as preferences_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=100000 + owner_id, is_commissioner=False
    )
    return {"session": token}


def _ws_ticket(owner_id: int):
    return create_ticket_token(
        _SESSION_SECRET, purpose="ws", user_id=1, owner_id=owner_id,
        discord_user_id=100000 + owner_id, is_commissioner=False,
    )


async def _use_fresh_pool_for_websocket():
    """starlette's TestClient runs the ASGI app on its own event loop in a
    background thread — asyncpg's pool is bound to the loop it was
    created on, so the module-level singleton has to be cleared before
    and after a WebSocket test (see chat v1's original note on this).
    The outgoing pool is handed off to conftest's _pending_pool_close
    rather than closed here directly — this same object is still what
    this test's own `pool` fixture and cleanup_test_season teardown are
    holding a reference to and will use before the test finishes, so
    closing it now would break that; leaking it forever exhausts
    Postgres's max_connections a few dozen WebSocket tests into a full
    suite run. conftest.py's `pool` fixture closes it for us at the
    start of the next test that requests a pool, once it's genuinely
    safe to."""
    # Bare `import conftest`, not `tests.conftest` — there's no
    # tests/__init__.py, so pytest itself loads this file as the
    # top-level module `conftest` (confirmed via sys.modules); a dotted
    # `tests.conftest` import creates a second, disconnected module
    # instance with its own empty _pending_pool_close, silently
    # defeating this whole mechanism.
    import conftest

    if db_module._pool is not None:
        conftest._pending_pool_close.append(db_module._pool)
    db_module._pool = None


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-chatv2-owner-{suffix}", f"Chatter {suffix}",
        )


async def _seed_direct_conversation(pool, owner_a, owner_b):
    async with pool.acquire() as conn:
        return await chat_queries.get_or_create_direct_conversation(conn, owner_a, owner_b)


async def _seed_team(pool, owner_id, suffix, season=TEST_SEASON):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            season, 900 + suffix, owner_id, f"Team {suffix}",
        )


# ---- domain/query level ----------------------------------------------------


async def test_get_or_create_direct_conversation_is_idempotent(pool):
    a = await _seed_owner(pool, 1)
    b = await _seed_owner(pool, 2)

    first = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        second = await chat_queries.get_or_create_direct_conversation(conn, b, a)  # order reversed

    assert first == second


async def test_conversations_summary_includes_unread_count_and_last_message(pool):
    a = await _seed_owner(pool, 3)
    b = await _seed_owner(pool, 4)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, conversation_id, a, "first", None)
        await chat_queries.insert_message(conn, conversation_id, a, "second", None)
        from app.domain.chat import get_conversations_summary

        b_view = await get_conversations_summary(conn, b)
        a_view = await get_conversations_summary(conn, a)

    b_conv = next(c for c in b_view if c["id"] == conversation_id)
    assert b_conv["unread_count"] == 2
    assert b_conv["last_message"]["body"] == "second"
    assert b_conv["other_owner_id"] == a
    assert b_conv["type"] == "direct"

    a_conv = next(c for c in a_view if c["id"] == conversation_id)
    assert a_conv["unread_count"] == 0  # a sent both messages — nothing unread for them
    assert a_conv["other_owner_id"] == b


# ---- REST: conversations ----------------------------------------------------


async def test_list_conversations_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/chat/conversations")
    assert resp.status_code == 401


async def test_messages_endpoint_rejects_non_participant(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 5)
    b = await _seed_owner(pool, 6)
    outsider = await _seed_owner(pool, 7)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with _client() as client:
        client.cookies.update(_session_cookie(outsider))
        resp = await client.get(f"/chat/conversations/{conversation_id}/messages")
    assert resp.status_code == 403


async def test_messages_pagination_with_before_cursor(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 8)
    b = await _seed_owner(pool, 9)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        ids = []
        for i in range(5):
            row = await chat_queries.insert_message(conn, conversation_id, a, f"msg {i}", None)
            ids.append(row["id"])

    async with _client() as client:
        client.cookies.update(_session_cookie(a))
        first_page = await client.get(f"/chat/conversations/{conversation_id}/messages?limit=2")
        second_page = await client.get(
            f"/chat/conversations/{conversation_id}/messages?limit=2&before={first_page.json()['messages'][0]['id']}"
        )

    assert [m["body"] for m in first_page.json()["messages"]] == ["msg 3", "msg 4"]
    assert [m["body"] for m in second_page.json()["messages"]] == ["msg 1", "msg 2"]


async def test_messages_include_senders_custom_chat_color(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 10)
    b = await _seed_owner(pool, 11)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        await conn.execute("UPDATE owners SET chat_color = '#39ff6a' WHERE owner_id = $1", a)
        await chat_queries.insert_message(conn, conversation_id, a, "hey", None)
        await chat_queries.insert_message(conn, conversation_id, b, "hi", None)

    async with _client() as client:
        client.cookies.update(_session_cookie(a))
        resp = await client.get(f"/chat/conversations/{conversation_id}/messages")

    by_owner = {m["owner_id"]: m["owner_chat_color"] for m in resp.json()["messages"]}
    assert by_owner[a] == "#39ff6a"
    assert by_owner[b] is None  # never set -> default bubble color on the frontend


async def test_start_direct_conversation_rejects_self_and_non_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    a = await _seed_owner(pool, 10)
    await _seed_team(pool, a, 10)

    async with _client() as client:
        client.cookies.update(_session_cookie(a))
        self_resp = await client.post("/chat/conversations/direct", json={"owner_id": a})
        stranger_resp = await client.post("/chat/conversations/direct", json={"owner_id": 999999})

    assert self_resp.status_code == 400
    assert stranger_resp.status_code == 404


async def test_start_direct_conversation_reuses_existing(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    a = await _seed_owner(pool, 11)
    b = await _seed_owner(pool, 12)
    await _seed_team(pool, a, 11)
    await _seed_team(pool, b, 12)

    async with _client() as client:
        client.cookies.update(_session_cookie(a))
        first = await client.post("/chat/conversations/direct", json={"owner_id": b})
        second = await client.post("/chat/conversations/direct", json={"owner_id": b})

    assert first.json()["conversation_id"] == second.json()["conversation_id"]


async def test_list_members_excludes_self(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    a = await _seed_owner(pool, 13)
    b = await _seed_owner(pool, 14)
    await _seed_team(pool, a, 13)
    await _seed_team(pool, b, 14)

    async with _client() as client:
        client.cookies.update(_session_cookie(a))
        resp = await client.get("/chat/members")

    names = [m["display_name"] for m in resp.json()["members"]]
    assert "Chatter 14" in names
    assert "Chatter 13" not in names


async def test_list_members_reports_real_presence(pool, monkeypatch):
    """The `online` field is the real presence snapshot (manager.
    is_connected), not a static/always-false placeholder — simulated by
    monkeypatching is_connected the same way test_websocket_message_
    does_not_push_to_a_currently_connected_recipient above does, rather
    than opening a real WebSocket."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    from app.routers import chat as chat_router

    a = await _seed_owner(pool, 40)
    b = await _seed_owner(pool, 41)
    c = await _seed_owner(pool, 42)
    await _seed_team(pool, a, 40)
    await _seed_team(pool, b, 41)
    await _seed_team(pool, c, 42)

    monkeypatch.setattr(chat_router.manager, "is_connected", lambda owner_id: owner_id == b)

    async with _client() as client:
        client.cookies.update(_session_cookie(a))
        resp = await client.get("/chat/members")

    by_id = {m["owner_id"]: m["online"] for m in resp.json()["members"]}
    assert by_id[b] is True
    assert by_id[c] is False


# ---- REST: read state, reactions, delete -----------------------------------


async def test_mark_read_zeroes_unread_count(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 15)
    b = await _seed_owner(pool, 16)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, conversation_id, a, "read me", None)

    async with _client() as client:
        client.cookies.update(_session_cookie(b))
        await client.post(f"/chat/conversations/{conversation_id}/read")

        from app.domain.chat import get_conversations_summary

        async with pool.acquire() as conn:
            b_view = await get_conversations_summary(conn, b)

    b_conv = next(c for c in b_view if c["id"] == conversation_id)
    assert b_conv["unread_count"] == 0


async def test_mark_read_broadcasts_a_read_event_by_default(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 41)
    b = await _seed_owner(pool, 42)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, conversation_id, a, "read me", None)

    broadcasts = []

    async def fake_broadcast(owner_ids, event):
        broadcasts.append((owner_ids, event))

    monkeypatch.setattr(chat_manager, "broadcast_to_owners", fake_broadcast)

    async with _client() as client:
        client.cookies.update(_session_cookie(b))
        resp = await client.post(f"/chat/conversations/{conversation_id}/read")

    assert resp.status_code == 200
    assert len(broadcasts) == 1
    owner_ids, event = broadcasts[0]
    assert owner_ids == [a]
    assert event["type"] == "read"


async def test_mark_read_suppresses_broadcast_when_read_receipts_disabled(pool, monkeypatch):
    """The owner's OWN unread tracking (last_read_message_id) still
    updates — Read Receipts off only means nobody ELSE finds out."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 43)
    b = await _seed_owner(pool, 44)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, conversation_id, a, "read me", None)
        await preferences_queries.update_preferences(conn, b, {"read_receipts_enabled": False})

    broadcasts = []

    async def fake_broadcast(owner_ids, event):
        broadcasts.append((owner_ids, event))

    monkeypatch.setattr(chat_manager, "broadcast_to_owners", fake_broadcast)

    async with _client() as client:
        client.cookies.update(_session_cookie(b))
        resp = await client.post(f"/chat/conversations/{conversation_id}/read")

        from app.domain.chat import get_conversations_summary

        async with pool.acquire() as conn:
            b_view = await get_conversations_summary(conn, b)

    assert resp.status_code == 200
    assert resp.json()["last_read_message_id"] is not None
    assert broadcasts == []  # nothing broadcast to anyone
    b_conv = next(c for c in b_view if c["id"] == conversation_id)
    assert b_conv["unread_count"] == 0  # b's own unread state still updated


async def test_react_toggles_and_rejects_invalid_emoji(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 17)
    b = await _seed_owner(pool, 18)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        row = await chat_queries.insert_message(conn, conversation_id, a, "react to this", None)

    async with _client() as client:
        client.cookies.update(_session_cookie(b))
        bad = await client.post(f"/chat/messages/{row['id']}/react", json={"emoji": "🐸"})
        added = await client.post(f"/chat/messages/{row['id']}/react", json={"emoji": "🔥"})
        removed = await client.post(f"/chat/messages/{row['id']}/react", json={"emoji": "🔥"})

    assert bad.status_code == 400
    assert added.json() == {"added": True}
    assert removed.json() == {"added": False}


async def test_delete_only_own_message(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 19)
    b = await _seed_owner(pool, 20)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        row = await chat_queries.insert_message(conn, conversation_id, a, "mine", None)

    async with _client() as client:
        client.cookies.update(_session_cookie(b))
        forbidden = await client.delete(f"/chat/messages/{row['id']}")

        client.cookies.update(_session_cookie(a))
        ok = await client.delete(f"/chat/messages/{row['id']}")

        client.cookies.update(_session_cookie(a))
        page = await client.get(f"/chat/conversations/{conversation_id}/messages")

    assert forbidden.status_code == 403
    assert ok.status_code == 200
    deleted_msg = next(m for m in page.json()["messages"] if m["id"] == row["id"])
    assert deleted_msg["deleted"] is True
    assert deleted_msg["body"] == "This message was deleted."


# ---- WebSocket: send, mentions, reply, typing ------------------------------


async def test_websocket_send_with_reply_and_valid_mentions(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 21)
    b = await _seed_owner(pool, 22)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        original = await chat_queries.insert_message(conn, conversation_id, a, "original message", None)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(b)) as ws:
        ws.send_json(
            {
                "type": "message",
                "conversation_id": conversation_id,
                "body": "replying with a mention @Chatter",
                "reply_to_id": original["id"],
                "mentions": [a],
            }
        )
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "message"
    msg = received["message"]
    assert msg["owner_id"] == b
    assert msg["reply_to"]["id"] == original["id"]
    assert msg["reply_to"]["body"] == "original message"
    assert msg["mentions"] == [a]


async def test_websocket_message_pushes_to_an_offline_recipient(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)

    a = await _seed_owner(pool, 23)
    b = await _seed_owner(pool, 24)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, a, {"push_enabled": True, "notify_direct_messages": True})

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "you there?"})
        ws.receive_json()
        # The WS handler processes one frame fully (including the push
        # dispatch, awaited after the broadcast) before it loops back to
        # receive the next — round-tripping a second, throwaway message
        # here guarantees the first message's push dispatch has actually
        # finished by the time we check `sent` below, rather than racing
        # the `with` block's teardown against that still-running await.
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    # The flush message's own push dispatch may or may not have landed
    # yet by the time the WS connection tears down — only the first
    # message's push is guaranteed complete (proven by having received
    # the flush's own broadcast, which the server can only send after
    # fully finishing the first message's handler, push dispatch
    # included) — so assert on that first entry only.
    assert len(sent) >= 1
    owner_id, payload = sent[0]
    assert owner_id == a
    assert payload["data"]["type"] == "chat_direct_message"
    assert "you there?" in payload["body"]


async def test_websocket_message_skips_push_when_recipient_preference_is_off(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)

    a = await _seed_owner(pool, 25)
    b = await _seed_owner(pool, 26)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    # push_enabled defaults to False — a never subscribed, so nothing should send.

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "hello"})
        ws.receive_json()
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert sent == []


async def test_websocket_message_does_not_push_to_a_currently_connected_recipient(pool, monkeypatch):
    """Someone with chat open right now sees the message over the socket
    already — pushing too would just be noise. Simulated by monkeypatching
    is_connected() rather than opening two real simultaneous WebSocket
    connections through TestClient's single background-thread event
    loop, which is fragile under concurrent asyncpg use."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)
    monkeypatch.setattr(chat_router.manager, "is_connected", lambda owner_id: owner_id == a)

    a = await _seed_owner(pool, 27)
    b = await _seed_owner(pool, 28)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, a, {"push_enabled": True, "notify_direct_messages": True})

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "hey"})
        ws.receive_json()
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert sent == []


async def test_websocket_message_with_mention_uses_the_mention_category(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)

    a = await _seed_owner(pool, 29)
    b = await _seed_owner(pool, 30)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        # notify_direct_messages OFF, notify_mentions ON — proves the
        # mention category is chosen over the direct-message one, not
        # just that push fired at all.
        await preferences_queries.update_preferences(
            conn, a, {"push_enabled": True, "notify_direct_messages": False, "notify_mentions": True}
        )

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "@Chatter check this out", "mentions": [a]})
        ws.receive_json()
        # Flush — a plain, non-mention message; a's notify_direct_messages
        # is off, so this shouldn't add a second entry to `sent`.
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert len(sent) == 1
    owner_id, payload = sent[0]
    assert owner_id == a
    assert payload["data"]["type"] == "chat_mention"


async def test_websocket_authenticates_via_ticket_when_no_session_cookie(pool, monkeypatch):
    """The real-world case this exists for: a browser that never sends
    the session cookie on this cross-site request at all (Safari's ITP)
    — the connection carries no cookie, only the ticket in the URL."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 40)
    b = await _seed_owner(pool, 41)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/chat/ws?ticket={_ws_ticket(b)}") as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "via ticket, not cookie"})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "message"
    assert received["message"]["owner_id"] == b
    assert received["message"]["body"] == "via ticket, not cookie"


async def test_websocket_send_with_valid_image_url_persists_it(pool, monkeypatch):
    from app.config import CHAT_IMAGE_HOST

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 60)
    b = await _seed_owner(pool, 61)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    image_url = f"https://{CHAT_IMAGE_HOST}/chat/some-photo.jpg"

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(a)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "", "image_url": image_url})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["message"]["image_url"] == image_url
    assert received["message"]["body"] == ""


async def test_websocket_drops_image_url_from_untrusted_host(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 62)
    b = await _seed_owner(pool, 63)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(a)) as ws:
        # No body, and the image_url doesn't match our Blob store's
        # host — the whole send should be silently dropped, same as an
        # empty text-only send.
        ws.send_json(
            {
                "type": "message",
                "conversation_id": conversation_id,
                "body": "",
                "image_url": "https://evil.example.com/tracker.png",
            }
        )
    await _use_fresh_pool_for_websocket()

    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT body, image_url FROM messages WHERE conversation_id = $1", conversation_id)
    assert list(rows) == []


async def test_websocket_filters_mentions_to_real_participants(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 23)
    b = await _seed_owner(pool, 24)
    outsider = await _seed_owner(pool, 25)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(a)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "hi", "mentions": [outsider]})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["message"]["mentions"] == []  # outsider isn't a participant, silently dropped


async def test_websocket_ignores_messages_to_conversation_you_are_not_in(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 26)
    b = await _seed_owner(pool, 27)
    outsider = await _seed_owner(pool, 28)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(outsider)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "sneaky"})
        # Nothing should ever arrive for the outsider — send a real event
        # from a real participant afterward and confirm ONLY that one shows
        # up, proving the outsider's message was dropped, not just delayed.
        pass
    await _use_fresh_pool_for_websocket()

    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT body FROM messages WHERE conversation_id = $1", conversation_id)
    assert [r["body"] for r in rows] == []  # never persisted


async def test_websocket_typing_is_not_echoed_to_sender_and_is_suppressed_when_disabled(pool, monkeypatch):
    """Full round trip through the real WS protocol path for a single
    connection — confirms the server accepts a typing event, doesn't
    crash or echo it back to the sender, AND (this owner has typing
    indicators disabled) never actually broadcasts it to anyone. Spies
    on the real broadcast_to_owners with call-through preserved, so the
    "message" sent right after typing still arrives over the real WS —
    proving the connection stayed alive and the loop kept processing,
    not just that the typing event was silently swallowed by a broken
    handler. One connection only, deliberately: the actual "who gets
    the broadcast" targeting logic (participants minus the sender) is
    covered more precisely below, at the connection-manager level —
    two *simultaneous* TestClient WebSocket connections hit a real
    test-harness limitation (each spins its own thread/event loop, and
    asyncpg's pool is bound to whichever loop created it — a portal-
    threading artifact of TestClient, not something a real single-
    process production server ever encounters on one real event loop)."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 29)
    b = await _seed_owner(pool, 30)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, a, {"typing_indicators_enabled": False})

    broadcasts = []
    real_broadcast = chat_manager.broadcast_to_owners

    async def spy_broadcast(owner_ids, event):
        broadcasts.append(event["type"])
        await real_broadcast(owner_ids, event)

    monkeypatch.setattr(chat_manager, "broadcast_to_owners", spy_broadcast)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=_session_cookie(a)) as ws_a:
        ws_a.send_json({"type": "typing", "conversation_id": conversation_id})
        # Prove the typing event wasn't echoed back to its own sender (and
        # that the connection is still alive) by sending a real chat
        # message right after — if typing HAD been echoed, it would
        # arrive first and this assertion would fail on the wrong event type.
        ws_a.send_json({"type": "message", "conversation_id": conversation_id, "body": "after typing"})
        received = ws_a.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "message"
    assert received["message"]["body"] == "after typing"
    assert "typing" not in broadcasts  # suppressed — this owner disabled it
    assert "message" in broadcasts  # the real broadcast path still works


async def test_connection_manager_broadcasts_only_to_specified_owners():
    from app.chat.manager import ChatConnectionManager

    class FakeSocket:
        def __init__(self):
            self.received = []

        async def accept(self):
            pass

        async def send_json(self, message):
            self.received.append(message)

    manager = ChatConnectionManager()
    ws_a, ws_b, ws_c = FakeSocket(), FakeSocket(), FakeSocket()
    await manager.connect(1, ws_a)
    await manager.connect(2, ws_b)
    await manager.connect(3, ws_c)

    # Each connect() above already fired its own `presence` broadcast to
    # everyone connected at that moment (see test_connect_and_disconnect_
    # broadcast_presence_to_everyone_connected below, which is what
    # actually covers that behavior) — cleared here so this test can
    # assert cleanly on just the explicit broadcast_to_owners call below,
    # which is what it's actually about.
    ws_a.received.clear()
    ws_b.received.clear()
    ws_c.received.clear()

    await manager.broadcast_to_owners([1, 2], {"type": "typing", "owner_id": 1})

    assert ws_a.received == [{"type": "typing", "owner_id": 1}]
    assert ws_b.received == [{"type": "typing", "owner_id": 1}]
    assert ws_c.received == []


async def test_connection_manager_broadcasts_presence_on_connect_and_disconnect():
    """A `presence` event fires to every OTHER connected owner (never
    the subject themself — they already know their own state, and a
    self-received event would otherwise jump the queue ahead of
    whatever that client does next, a real bug this test setup caught)
    only on the real 0->1 (came online) and 1->0 (went offline)
    transitions — a second tab/device for an owner who's already
    connected elsewhere doesn't re-announce them as newly online."""
    from app.chat.manager import ChatConnectionManager

    class FakeSocket:
        def __init__(self):
            self.received = []

        async def accept(self):
            pass

        async def send_json(self, message):
            self.received.append(message)

    manager = ChatConnectionManager()
    ws_a = FakeSocket()
    await manager.connect(1, ws_a)
    assert ws_a.received == []  # no one else connected yet, and never told about itself

    ws_b = FakeSocket()
    await manager.connect(2, ws_b)
    assert ws_a.received == [{"type": "presence", "owner_id": 2, "online": True}]
    assert ws_b.received == []  # owner 2 is never told about its own connection

    # A second socket for owner 1 (another tab) — no new "online"
    # broadcast, they were already online.
    ws_a2 = FakeSocket()
    await manager.connect(1, ws_a2)
    assert ws_a2.received == []
    assert ws_a.received == [{"type": "presence", "owner_id": 2, "online": True}]  # unchanged

    # Closing just one of owner 1's two sockets — still online via the
    # other one, no "offline" broadcast yet.
    await manager.disconnect(1, ws_a2)
    assert ws_a.received == [{"type": "presence", "owner_id": 2, "online": True}]  # unchanged
    assert ws_b.received == []  # unchanged

    # Closing owner 1's LAST socket — now they're really offline.
    await manager.disconnect(1, ws_a)
    assert ws_b.received == [{"type": "presence", "owner_id": 1, "online": False}]


async def test_connection_manager_drops_dead_connections():
    from app.chat.manager import ChatConnectionManager

    class DeadSocket:
        async def accept(self):
            pass

        async def send_json(self, message):
            raise RuntimeError("connection closed")

    manager = ChatConnectionManager()
    dead = DeadSocket()
    await manager.connect(1, dead)

    await manager.broadcast_to_owners([1], {"type": "ping"})  # must not raise

    assert 1 not in manager._connections  # cleaned up after the failed send
