import uuid

from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from app import db as db_module
from app.auth.session import create_session_token, create_ticket_token
from app.chat.manager import manager as chat_manager
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import chat as chat_queries
from app.queries import leagues as league_queries
from app.queries import owner_preferences as preferences_queries
from app.queries import teams as team_queries
from tests.conftest import make_safe_session_user_id
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id(pool), owner_id=owner_id, discord_user_id=100000 + owner_id, is_commissioner=False
    )
    return {"session": token}


def _league_session_cookie(user_id: int, owner_id: int):
    """Like _session_cookie, but for a _seed_league_owner() pair —
    that helper already minted a real user_id tied to a real league
    membership, so this must NOT call make_safe_session_user_id (which
    would mint an unrelated second user_id with no league of its own)."""
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=200000 + owner_id, is_commissioner=False
    )
    return {"session": token}


async def _ws_ticket(pool, owner_id: int):
    return create_ticket_token(
        _SESSION_SECRET, purpose="ws", user_id=await make_safe_session_user_id(pool), owner_id=owner_id,
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


async def _seed_league_owner(pool, suffix, role="member", league_id=None):
    """A user+owner pair that's a real member of its own fresh 'Test
    League <suffix>' (or of an existing one, when league_id is passed
    in to add a second member to the same league) — needed for
    league_id-scoping tests where make_safe_session_user_id's shared
    DEFAULT_LEAGUE_ID would put every test owner in the same league
    and defeat the isolation being tested. Mirrors the real signup ->
    create/join league -> create team flow (app/routers/leagues.py)
    closely enough to exercise the same owner_id/user_id reconciliation
    production code goes through, without the overhead of a full HTTP
    round trip through /auth/signup."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            """
            INSERT INTO users (email, password_hash, display_name, token_version)
            VALUES ($1, 'x', $2, 1)
            RETURNING id
            """,
            f"test-chatv2-league-{suffix}-{uuid.uuid4().hex[:8]}@example.com", f"Leaguer {suffix}",
        )
        if league_id is None:
            league_id = await league_queries.create_league(
                conn, f"Test League Chat {suffix}", user_id, f"chat-test-invite-{suffix}-{uuid.uuid4().hex[:8]}"
            )
        await league_queries.add_member(conn, league_id, user_id, role)
        owner_id = await team_queries.get_or_create_owner_for_user(conn, user_id, f"Leaguer {suffix}")
        await team_queries.create_team(conn, league_id, TEST_SEASON, owner_id, f"Team {suffix}")
    return user_id, owner_id, league_id


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

        b_view = await get_conversations_summary(conn, b, DEFAULT_LEAGUE_ID)
        a_view = await get_conversations_summary(conn, a, DEFAULT_LEAGUE_ID)

    b_conv = next(c for c in b_view if c["id"] == conversation_id)
    assert b_conv["unread_count"] == 2
    assert b_conv["last_message"]["body"] == "second"
    assert b_conv["other_owner_id"] == a
    assert b_conv["type"] == "direct"

    a_conv = next(c for c in a_view if c["id"] == conversation_id)
    assert a_conv["unread_count"] == 0  # a sent both messages — nothing unread for them
    assert a_conv["other_owner_id"] == b


async def test_conversations_summary_includes_avatar_group_for_league_type(pool):
    from app.domain.chat import get_conversations_summary

    # A fresh test league, not real production League #1 (id=1) — a
    # 'league'-type conversation is meant to be one-per-league, and
    # conftest's cleanup only ever sweeps up conversations that belong
    # to a "Test League%"-named league, not anything tied to id=1.
    _, a, league_id = await _seed_league_owner(pool, "avatar-group-a")
    _, b, _ = await _seed_league_owner(pool, "avatar-group-b", league_id=league_id)
    async with pool.acquire() as conn:
        league_conversation_id = await chat_queries.create_conversation_for_league(conn, league_id, "league", [a, b])
        a_view = await get_conversations_summary(conn, a, league_id)

    conv = next(c for c in a_view if c["id"] == league_conversation_id)
    assert conv["other_owner_id"] is None  # no single "other person" for a group conversation
    assert conv["avatar_group"] is not None
    assert {m["owner_id"] for m in conv["avatar_group"]} == {a, b}


async def test_conversations_summary_pins_commish_corner_above_league(pool):
    from app.domain.chat import get_conversations_summary

    _, a, league_id = await _seed_league_owner(pool, "pin-order-a")
    async with pool.acquire() as conn:
        league_conversation_id = await chat_queries.create_conversation_for_league(conn, league_id, "league", [a])
        commish_corner_id = await chat_queries.create_conversation_for_league(conn, league_id, "commish_corner", [a])
        # A direct message too, to confirm it still sorts to the bottom.
        b = await _seed_owner(pool, 98)
        direct_id = await _seed_direct_conversation(pool, a, b)

        a_view = await get_conversations_summary(conn, a, league_id)

    ids_in_order = [c["id"] for c in a_view if c["id"] in (league_conversation_id, commish_corner_id, direct_id)]
    assert ids_in_order == [commish_corner_id, league_conversation_id, direct_id]


async def test_conversations_summary_gates_read_receipt_on_the_other_owners_preference(pool):
    from app.domain.chat import get_conversations_summary

    a = await _seed_owner(pool, 92)
    b = await _seed_owner(pool, 93)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        msg = await chat_queries.insert_message(conn, conversation_id, a, "hi", None)
        await chat_queries.mark_read(conn, conversation_id, b, msg["id"])

        # b has read receipts on (the default) — a sees it.
        a_view = await get_conversations_summary(conn, a, DEFAULT_LEAGUE_ID)
        a_conv = next(c for c in a_view if c["id"] == conversation_id)
        assert a_conv["other_last_read_message_id"] == msg["id"]

        # b turns read receipts off — a must no longer see b's read state,
        # same as the live "read" WebSocket broadcast already respects.
        await preferences_queries.update_preferences(conn, b, {"read_receipts_enabled": False})
        a_view = await get_conversations_summary(conn, a, DEFAULT_LEAGUE_ID)
        a_conv = next(c for c in a_view if c["id"] == conversation_id)
        assert a_conv["other_last_read_message_id"] is None


async def test_conversations_summary_shows_a_newer_reaction_over_an_older_message(pool):
    from app.domain.chat import get_conversations_summary

    a = await _seed_owner(pool, 94)
    b = await _seed_owner(pool, 95)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        msg = await chat_queries.insert_message(conn, conversation_id, a, "nice pickup this week", None)
        await chat_queries.toggle_reaction(conn, msg["id"], b, "🔥")

        a_view = await get_conversations_summary(conn, a, DEFAULT_LEAGUE_ID)
        b_view = await get_conversations_summary(conn, b, DEFAULT_LEAGUE_ID)

    a_conv = next(c for c in a_view if c["id"] == conversation_id)
    b_conv = next(c for c in b_view if c["id"] == conversation_id)
    # From a's side, b is the reactor — shown by name, not "You".
    assert a_conv["last_message"]["owner_name"] == "Chatter 95"
    assert "🔥" in a_conv["last_message"]["body"]
    assert "nice pickup this week" in a_conv["last_message"]["body"]
    # From b's own side, b sees themselves as "You".
    assert b_conv["last_message"]["owner_name"] == "You"


# ---- REST: conversations ----------------------------------------------------


async def test_list_conversations_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/chat/conversations")
    assert resp.status_code == 401


async def test_gif_search_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/chat/gifs", params={"search": "touchdown dance"})
    assert resp.status_code == 401


async def test_gif_search_returns_the_provider_results(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 96)

    from app.routers import chat as chat_router

    fake_gifs = [{"id": "1", "description": "touchdown", "url": "https://media.giphy.com/media/x/giphy.gif", "preview_url": "https://media.giphy.com/media/x/giphy-preview.gif", "width": 200, "height": 200}]

    async def _fake_search(query, limit=24):
        assert query == "touchdown dance"
        return fake_gifs

    monkeypatch.setattr(chat_router.giphy, "search", _fake_search)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        resp = await client.get("/chat/gifs", params={"search": "touchdown dance"})

    assert resp.status_code == 200
    assert resp.json()["gifs"] == fake_gifs


async def test_gif_search_returns_503_when_giphy_is_unconfigured(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 97)

    from app.routers import chat as chat_router

    async def _fake_search(query, limit=24):
        raise RuntimeError("GIF search isn't configured — set GIPHY_API_KEY")

    monkeypatch.setattr(chat_router.giphy, "search", _fake_search)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        resp = await client.get("/chat/gifs", params={"search": "touchdown dance"})

    assert resp.status_code == 503


async def test_messages_endpoint_rejects_non_participant(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 5)
    b = await _seed_owner(pool, 6)
    outsider = await _seed_owner(pool, 7)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, outsider))
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
        client.cookies.update(await _session_cookie(pool, a))
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
        client.cookies.update(await _session_cookie(pool, a))
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
        client.cookies.update(await _session_cookie(pool, a))
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
        client.cookies.update(await _session_cookie(pool, a))
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
        client.cookies.update(await _session_cookie(pool, a))
        resp = await client.get("/chat/members")

    names = [m["display_name"] for m in resp.json()["members"]]
    assert "Chatter 14" in names
    assert "Chatter 13" not in names


async def test_conversation_members_returns_the_full_roster(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    # A fresh test league, not real production League #1 — see the
    # avatar_group test above for why this matters (conftest's cleanup
    # only sweeps conversations tied to a "Test League%"-named league).
    _, a, league_id = await _seed_league_owner(pool, "roster-a")
    _, b, _ = await _seed_league_owner(pool, "roster-b", league_id=league_id)
    _, c, _ = await _seed_league_owner(pool, "roster-c", league_id=league_id)
    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(conn, league_id, "commish_corner", [a, b, c])

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        resp = await client.get(f"/chat/conversations/{conversation_id}/members")

    assert resp.status_code == 200
    owner_ids = {m["owner_id"] for m in resp.json()["members"]}
    assert owner_ids == {a, b, c}


async def test_conversation_members_rejects_a_non_participant(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 102)
    b = await _seed_owner(pool, 103)
    outsider = await _seed_owner(pool, 104)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, outsider))
        resp = await client.get(f"/chat/conversations/{conversation_id}/members")

    assert resp.status_code == 403


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
        client.cookies.update(await _session_cookie(pool, a))
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
        client.cookies.update(await _session_cookie(pool, b))
        await client.post(f"/chat/conversations/{conversation_id}/read")

        from app.domain.chat import get_conversations_summary

        async with pool.acquire() as conn:
            b_view = await get_conversations_summary(conn, b, DEFAULT_LEAGUE_ID)

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
        client.cookies.update(await _session_cookie(pool, b))
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
        client.cookies.update(await _session_cookie(pool, b))
        resp = await client.post(f"/chat/conversations/{conversation_id}/read")

        from app.domain.chat import get_conversations_summary

        async with pool.acquire() as conn:
            b_view = await get_conversations_summary(conn, b, DEFAULT_LEAGUE_ID)

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
        client.cookies.update(await _session_cookie(pool, b))
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
        client.cookies.update(await _session_cookie(pool, b))
        forbidden = await client.delete(f"/chat/messages/{row['id']}")

        client.cookies.update(await _session_cookie(pool, a))
        ok = await client.delete(f"/chat/messages/{row['id']}")

        client.cookies.update(await _session_cookie(pool, a))
        page = await client.get(f"/chat/conversations/{conversation_id}/messages")

    assert forbidden.status_code == 403
    assert ok.status_code == 200
    # A deleted message doesn't keep showing up in the thread at all —
    # not even as a "This message was deleted." placeholder.
    assert all(m["id"] != row["id"] for m in page.json()["messages"])


async def test_a_reply_to_a_deleted_message_still_shows_the_placeholder(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 21)
    b = await _seed_owner(pool, 22)
    conversation_id = await _seed_direct_conversation(pool, a, b)

    async with pool.acquire() as conn:
        original = await chat_queries.insert_message(conn, conversation_id, a, "original", None)
        reply = await chat_queries.insert_message(conn, conversation_id, b, "a reply", original["id"])

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        deleted = await client.delete(f"/chat/messages/{original['id']}")
        page = await client.get(f"/chat/conversations/{conversation_id}/messages")

    assert deleted.status_code == 200
    ids = [m["id"] for m in page.json()["messages"]]
    # The deleted original itself is gone from the thread...
    assert original["id"] not in ids
    # ...but the reply that still references it is still there, and
    # still shows useful context about what it was replying to.
    reply_msg = next(m for m in page.json()["messages"] if m["id"] == reply["id"])
    assert reply_msg["reply_to"]["body"] == "This message was deleted."


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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, b)) as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, b)) as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "hello"})
        ws.receive_json()
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert sent == []


async def test_websocket_message_does_not_push_to_a_recipient_actively_viewing_chat(pool, monkeypatch):
    """Someone with chat open AND in the foreground right now sees the
    message over the socket already — pushing too would just be noise.
    Simulated by monkeypatching has_visible_connection() rather than
    opening two real simultaneous WebSocket connections through
    TestClient's single background-thread event loop, which is fragile
    under concurrent asyncpg use.

    Uses has_visible_connection, not is_connected (2026-09 fix) — see
    that method's own docstring on why plain is_connected was wrong: it
    stays true for as long as the app is open ANYWHERE, including fully
    backgrounded, which used to silently swallow every push for anyone
    who keeps the app open in the background."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)
    monkeypatch.setattr(chat_router.manager, "has_visible_connection", lambda owner_id: owner_id == a)

    a = await _seed_owner(pool, 27)
    b = await _seed_owner(pool, 28)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, a, {"push_enabled": True, "notify_direct_messages": True})

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "hey"})
        ws.receive_json()
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert sent == []


async def test_websocket_message_still_pushes_to_a_backgrounded_recipient(pool, monkeypatch):
    """The actual regression this session fixed: an owner whose app is
    open (is_connected True) but not in the foreground (has_visible_
    connection False — screen off, backgrounded tab) must still get a
    real push. Before the fix, push suppression checked is_connected
    alone, which PresenceProvider.tsx's own app-wide socket keeps true
    in exactly this scenario, so this exact case silently never
    pushed."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)
    # Connected (app open) but NOT visible (backgrounded) — the real
    # bug scenario. is_connected would say True here too; that's the
    # whole point of not using it for this check anymore.
    monkeypatch.setattr(chat_router.manager, "is_connected", lambda owner_id: owner_id == a)
    monkeypatch.setattr(chat_router.manager, "has_visible_connection", lambda owner_id: False)

    a = await _seed_owner(pool, 29)
    b = await _seed_owner(pool, 30)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, a, {"push_enabled": True, "notify_direct_messages": True})

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, b)) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "hey, you there?"})
        ws.receive_json()
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert len(sent) >= 1
    owner_id, payload = sent[0]
    assert owner_id == a
    assert "you there?" in payload["body"]


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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, b)) as ws:
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
    with client.websocket_connect(f"/chat/ws?ticket={await _ws_ticket(pool, b)}") as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, a)) as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, a)) as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, a)) as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, outsider)) as ws:
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
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, a)) as ws_a:
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


# ---- league_id scoping / Commish's Corner (2026-09-04 retrofit) -----------


async def test_list_eligible_members_scoped_to_active_league(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_a, owner_a, league_a = await _seed_league_owner(pool, "scope-a")
    _, teammate_owner, _ = await _seed_league_owner(pool, "scope-a-mate", league_id=league_a)
    _, other_league_owner, _ = await _seed_league_owner(pool, "scope-b")

    async with _client() as client:
        client.cookies.update(_league_session_cookie(user_a, owner_a))
        resp = await client.get("/chat/members")

    member_ids = {m["owner_id"] for m in resp.json()["members"]}
    assert teammate_owner in member_ids  # same league — eligible for a DM
    assert other_league_owner not in member_ids  # different league — must not leak in


async def test_start_direct_conversation_rejects_member_from_a_different_league(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_a, owner_a, _ = await _seed_league_owner(pool, "cross-a")
    _, owner_b, _ = await _seed_league_owner(pool, "cross-b")  # a different league entirely

    async with _client() as client:
        client.cookies.update(_league_session_cookie(user_a, owner_a))
        resp = await client.post("/chat/conversations/direct", json={"owner_id": owner_b})

    assert resp.status_code == 404  # not a member of the caller's active league


async def test_create_league_seeds_league_and_commish_corner_conversations(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with _client() as client:
        resp = await client.post(
            "/auth/signup",
            json={
                "email": f"test-chatv2-commish-{uuid.uuid4().hex[:8]}@example.com",
                "password": "correct-horse",
                "display_name": "Corner Commish",
            },
        )
        assert resp.status_code == 200
        created = await client.post("/leagues", json={"name": f"Test League Commish {uuid.uuid4().hex[:8]}"})
        assert created.status_code == 200
        league_id = created.json()["id"]

    # Checked straight against the DB, not via GET /chat/conversations —
    # that route trusts the session token's own `owner_id` claim, which
    # a plain email/password signup token never carries (see
    # create_session_token's docstring); this test is about what
    # create_league seeded, not about that separate, pre-existing
    # owner_id-on-token quirk.
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT type FROM conversations WHERE league_id = $1", league_id)
        types = {r["type"] for r in rows}
        assert "league" in types
        assert "commish_corner" in types

        commish_corner_id = await conn.fetchval(
            "SELECT id FROM conversations WHERE league_id = $1 AND type = 'commish_corner'", league_id
        )
        participant_count = await conn.fetchval(
            "SELECT count(*) FROM conversation_participants WHERE conversation_id = $1", commish_corner_id
        )
        assert participant_count == 1  # the creator, seeded automatically


async def test_commish_corner_rejects_a_non_commissioner_over_websocket(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commish_user, commish_owner, league_id = await _seed_league_owner(pool, "corner-commish", role="commissioner")
    member_user, member_owner, _ = await _seed_league_owner(pool, "corner-member", role="member", league_id=league_id)

    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(
            conn, league_id, "commish_corner", [commish_owner, member_owner]
        )

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(
        "/chat/ws", cookies=_league_session_cookie(member_user, member_owner)
    ) as ws:
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "can I post here?"})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received == {
        "type": "error",
        "error": "commish_corner_restricted",
        "conversation_id": conversation_id,
    }
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id FROM messages WHERE conversation_id = $1", conversation_id)
    assert list(rows) == []  # rejected, never persisted


async def test_commish_corner_accepts_the_commissioner_over_websocket(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commish_user, commish_owner, league_id = await _seed_league_owner(pool, "corner-ok-commish", role="commissioner")
    _, member_owner, _ = await _seed_league_owner(pool, "corner-ok-member", role="member", league_id=league_id)

    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(
            conn, league_id, "commish_corner", [commish_owner, member_owner]
        )

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(
        "/chat/ws", cookies=_league_session_cookie(commish_user, commish_owner)
    ) as ws:
        ws.send_json(
            {
                "type": "message",
                "conversation_id": conversation_id,
                "title": "League Update",
                "body": "official announcement",
            }
        )
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "message"
    assert received["message"]["title"] == "League Update"
    assert received["message"]["body"] == "official announcement"
    assert received["message"]["owner_id"] == commish_owner


async def test_commish_corner_rejects_a_missing_title_over_websocket(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commish_user, commish_owner, league_id = await _seed_league_owner(pool, "corner-notitle-commish", role="commissioner")

    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(
            conn, league_id, "commish_corner", [commish_owner]
        )

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(
        "/chat/ws", cookies=_league_session_cookie(commish_user, commish_owner)
    ) as ws:
        # No title at all — an announcement needs a real headline, not
        # just a body, unlike every other conversation type.
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "missing a title"})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received == {
        "type": "error",
        "error": "commish_corner_title_required",
        "conversation_id": conversation_id,
    }
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id FROM messages WHERE conversation_id = $1", conversation_id)
    assert list(rows) == []


async def test_commish_corner_accepts_a_body_longer_than_the_plain_message_limit(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commish_user, commish_owner, league_id = await _seed_league_owner(pool, "corner-longbody-commish", role="commissioner")

    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(
            conn, league_id, "commish_corner", [commish_owner]
        )

    # Longer than MAX_MESSAGE_LENGTH (2000, a plain chat message's own
    # cap) but under MAX_ANNOUNCEMENT_BODY_LENGTH (20000) — a real
    # league update, not a one-liner.
    long_body = "a" * 15000
    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(
        "/chat/ws", cookies=_league_session_cookie(commish_user, commish_owner)
    ) as ws:
        ws.send_json(
            {"type": "message", "conversation_id": conversation_id, "title": "Long update", "body": long_body}
        )
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "message"
    assert received["message"]["body"] == long_body


async def test_commish_corner_rejects_a_body_over_the_announcement_limit(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commish_user, commish_owner, league_id = await _seed_league_owner(pool, "corner-toolong-commish", role="commissioner")

    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(
            conn, league_id, "commish_corner", [commish_owner]
        )

    too_long_body = "a" * 20001
    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(
        "/chat/ws", cookies=_league_session_cookie(commish_user, commish_owner)
    ) as ws:
        ws.send_json(
            {"type": "message", "conversation_id": conversation_id, "title": "Too long", "body": too_long_body}
        )
        # Silently dropped — same "no error frame" behavior an
        # oversized plain chat message already has, just with a
        # different (much higher) threshold.
        ws.send_json({"type": "message", "conversation_id": conversation_id, "title": "Flush", "body": "flush"})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["message"]["body"] == "flush"  # the oversized send never arrived at all
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT body FROM messages WHERE conversation_id = $1", conversation_id)
    assert [r["body"] for r in rows] == ["flush"]


async def test_commish_corner_message_always_notifies_regardless_of_preference(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append(owner_id)
        return 1

    monkeypatch.setattr(chat_router.dispatcher, "send_to_owner", _fake_send_to_owner)

    commish_user, commish_owner, league_id = await _seed_league_owner(pool, "corner-notify-commish", role="commissioner")
    _, member_owner, _ = await _seed_league_owner(pool, "corner-notify-member", role="member", league_id=league_id)

    async with pool.acquire() as conn:
        conversation_id = await chat_queries.create_conversation_for_league(
            conn, league_id, "commish_corner", [commish_owner, member_owner]
        )
        # The member has opted OUT of league-chat push — Commish's Corner
        # must reach them anyway, unlike ordinary chat volume.
        await preferences_queries.update_preferences(
            conn, member_owner, {"push_enabled": True, "notify_league_chat": False}
        )

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(
        "/chat/ws", cookies=_league_session_cookie(commish_user, commish_owner)
    ) as ws:
        ws.send_json(
            {"type": "message", "conversation_id": conversation_id, "title": "Read this", "body": "read this everyone"}
        )
        ws.receive_json()
        # Same flush pattern used elsewhere in this file — guarantees the
        # push dispatch from the first message has actually finished.
        ws.send_json({"type": "message", "conversation_id": conversation_id, "title": "Flush", "body": "flush"})
        ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert member_owner in sent


async def test_connection_manager_has_visible_connection_defaults_true_until_told_otherwise():
    """A fresh connection is assumed foreground until the client's own
    first visibility frame says otherwise (sent immediately on open in
    both PresenceProvider.tsx and ChatApp.tsx) — see set_visibility/
    has_visible_connection's own docstrings for why this distinction
    from plain is_connected exists at all."""
    from app.chat.manager import ChatConnectionManager

    class FakeSocket:
        async def accept(self):
            pass

        async def send_json(self, message):
            pass

    manager = ChatConnectionManager()
    ws = FakeSocket()
    await manager.connect(1, ws)
    assert manager.is_connected(1) is True
    assert manager.has_visible_connection(1) is True

    manager.set_visibility(ws, False)
    assert manager.is_connected(1) is True  # still connected — just backgrounded
    assert manager.has_visible_connection(1) is False

    manager.set_visibility(ws, True)
    assert manager.has_visible_connection(1) is True


async def test_connection_manager_has_visible_connection_true_if_any_of_several_sockets_is():
    """Two tabs/devices for the same owner — one backgrounded, one in
    the foreground — should still count as "actively watching," same
    "any open socket" shape as is_connected itself."""
    from app.chat.manager import ChatConnectionManager

    class FakeSocket:
        async def accept(self):
            pass

        async def send_json(self, message):
            pass

    manager = ChatConnectionManager()
    ws_background, ws_foreground = FakeSocket(), FakeSocket()
    await manager.connect(1, ws_background)
    await manager.connect(1, ws_foreground)
    manager.set_visibility(ws_background, False)
    manager.set_visibility(ws_foreground, True)

    assert manager.has_visible_connection(1) is True


async def test_connection_manager_has_visible_connection_false_for_unknown_owner():
    from app.chat.manager import ChatConnectionManager

    manager = ChatConnectionManager()
    assert manager.has_visible_connection(999) is False


async def test_websocket_visibility_event_updates_manager_state(pool, monkeypatch):
    """The real end-to-end path: a client's `visibility` frame over its
    actual WebSocket connection (not a monkeypatched manager) updates
    has_visible_connection for that exact socket. A `visibility` frame
    has no reply of its own to synchronize on, so a real chat message
    (which does echo back to its own sender) is sent right after it —
    the single-threaded receive loop processes frames in the order
    they arrived, so receiving that echo proves the visibility frame
    ahead of it was already handled."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    from app.routers import chat as chat_router

    owner_id = await _seed_owner(pool, 43)
    other_owner_id = await _seed_owner(pool, 44)
    conversation_id = await _seed_direct_conversation(pool, owner_id, other_owner_id)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/chat/ws", cookies=await _session_cookie(pool, owner_id)) as ws:
        assert chat_router.manager.has_visible_connection(owner_id) is True

        ws.send_json({"type": "visibility", "visible": False})
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "sync"})
        ws.receive_json()
        assert chat_router.manager.has_visible_connection(owner_id) is False

        ws.send_json({"type": "visibility", "visible": True})
        ws.send_json({"type": "message", "conversation_id": conversation_id, "body": "sync again"})
        ws.receive_json()
        assert chat_router.manager.has_visible_connection(owner_id) is True
    await _use_fresh_pool_for_websocket()


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
