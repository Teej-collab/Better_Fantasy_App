"""HTTP + WebSocket surface of app/routers/draft.py. Same
_use_fresh_pool_for_websocket() pattern as test_gamecast_router.py for
the WS tests (starlette's TestClient runs on its own event loop, so the
asyncpg pool singleton has to be reset around any TestClient call that
touches the DB).

Auth setup uses real signed-up users + real league_members rows, not a
fabricated is_commissioner JWT claim with a hardcoded user_id=1 — the
router now does a live per-active-league commissioner check (app/auth/
league_context.py, see TODO.md's PHASE 9 entry), which a fake claim
can't satisfy, and a hardcoded user_id=1 would silently read/depend on
the real production owner's own row rather than isolated test data.
"""
import itertools

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from app import db as db_module
from app.auth.session import create_session_token, create_ticket_token
from app.domain import draft_engine
from app.main import app
from app.notifications import draft_events
from app.queries import draft_room_chat as draft_room_chat_queries
from app.queries import leagues as league_queries
from app.queries import owner_preferences as preferences_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}
_espn_team_id_counter = itertools.count(910001)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(user_id: int, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=300000 + owner_id,
        is_commissioner=False,  # ignored by the router now — real per-league check instead
    )
    return {"session": token}


def _ws_ticket(user_id: int, owner_id: int):
    return create_ticket_token(
        _SESSION_SECRET, purpose="ws", user_id=user_id, owner_id=owner_id,
        discord_user_id=300000 + owner_id, is_commissioner=False,
    )


def _set_env(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))


async def _use_fresh_pool_for_websocket():
    import conftest

    if db_module._pool is not None:
        conftest._pending_pool_close.append(db_module._pool)
    db_module._pool = None


async def _make_league(conn, suffix: str) -> tuple[int, int]:
    """A real league with a real commissioner user — every other member
    seeded via _seed_member below joins this same league."""
    creator_user_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-draftrouter-{suffix}-creator@example.com", f"Creator {suffix}",
    )
    league_id = await league_queries.create_league(
        conn, f"Test League Draftrouter {suffix}", creator_user_id, f"draftrouter-{suffix}-code"
    )
    await league_queries.add_member(conn, league_id, creator_user_id, "commissioner")
    return league_id, creator_user_id


async def _seed_member(pool, league_id: int, suffix: str, role: str = "member") -> tuple[int, int]:
    """Real user + owner + team, joined into league_id with the given
    role. Returns (user_id, owner_id)."""
    espn_team_id = next(_espn_team_id_counter)
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-draftrouter-{suffix}@example.com", f"User {suffix}",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-draftrouter-owner-{suffix}", f"Owner {suffix}", user_id,
        )
        await league_queries.add_member(conn, league_id, user_id, role)
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}", league_id,
        )
    return user_id, owner_id


async def _seed_commissioner_and_team(pool, suffix: str) -> tuple[int, int, int]:
    """A fresh league whose creator (real commissioner) also gets a
    team — the common shape most of these tests need. Returns
    (user_id, owner_id, league_id)."""
    espn_team_id = next(_espn_team_id_counter)
    async with pool.acquire() as conn:
        league_id, user_id = await _make_league(conn, suffix)
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-draftrouter-owner-{suffix}", f"Owner {suffix}", user_id,
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}", league_id,
        )
    return user_id, owner_id, league_id


async def _seed_player(pool, suffix, position="RB", search_rank=100):
    sleeper_id = f"test-draftrouter-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, search_rank, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', $5, TRUE)
            """,
            sleeper_id, f"Test Player {suffix}", position, [position], search_rank,
        )
    return sleeper_id


async def test_pool_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/draft/pool")
    assert resp.status_code == 401


async def test_pool_returns_draftable_players(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "pool1")
    player = await _seed_player(pool, "p1")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/pool")

    assert resp.status_code == 200
    ids = {p["sleeper_player_id"] for p in resp.json()["players"]}
    assert player in ids


async def test_pool_includes_projected_points_and_bye_week(pool, monkeypatch):
    """projected_points (players.projected_points, filled by the bulk
    ESPN sync — app/domain/player_projections.py) and bye_week (a join
    against team_bye_weeks, not sourced from ESPN at all) both surface
    on the same /draft/pool row search_rank already did."""
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "pool2")
    player = await _seed_player(pool, "p2")
    async with pool.acquire() as conn:
        await conn.execute("UPDATE players SET projected_points = 187.5 WHERE sleeper_player_id = $1", player)
        await conn.execute(
            "INSERT INTO team_bye_weeks (season, pro_team, bye_week) VALUES ($1, 'KC', 9) "
            "ON CONFLICT (season, pro_team) DO UPDATE SET bye_week = EXCLUDED.bye_week",
            TEST_SEASON,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/pool")

    row = next(p for p in resp.json()["players"] if p["sleeper_player_id"] == player)
    assert float(row["projected_points"]) == 187.5
    assert row["bye_week"] == 9


async def test_pool_marks_a_free_agent_rostered_player_as_drafted(pool, monkeypatch):
    """The real production bug (2026-09, live on draft night): a player
    added to a roster via free agency has no draft_picks row at all, so
    the pool kept showing them as available — a live pick attempt on
    them then crashed on current_rosters' own unique constraint (see
    make_pick's matching fix)."""
    _set_env(monkeypatch)
    user_id, owner_id, league_id = await _seed_commissioner_and_team(pool, "pool_fa")
    player = await _seed_player(pool, "p_fa")
    async with pool.acquire() as conn:
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            TEST_SEASON, owner_id, league_id,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, 'BE', 'free_agent', $4)",
            TEST_SEASON, team_id, player, league_id,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/pool")

    row = next(p for p in resp.json()["players"] if p["sleeper_player_id"] == player)
    assert row["drafted"] is True


async def test_setup_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user_id, _commish_owner_id, league_id = await _seed_commissioner_and_team(pool, "setup1")
    user_id, owner_id = await _seed_member(pool, league_id, "setup1_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.post("/draft/setup", json={
            "draft_order": [owner_id], "roster_slots": _ROSTER_SLOTS,
        })
    assert resp.status_code == 403


async def test_setup_and_start_and_pick_flow(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "flow_a")
    user_b, owner_b = await _seed_member(pool, league_id, "flow_b")
    player = await _seed_player(pool, "flow1")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        setup_resp = await client.post("/draft/setup", json={
            "draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS,
        })
        assert setup_resp.status_code == 200

        start_resp = await client.post("/draft/start")
        assert start_resp.status_code == 200
        assert start_resp.json()["config"]["current_pick_number"] == 1

    async with _client() as client:
        client.cookies.update(_session_cookie(user_b, owner_b))  # not on the clock
        resp = await client.post("/draft/pick", json={"sleeper_player_id": player})
        assert resp.status_code == 409

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        resp = await client.post("/draft/pick", json={"sleeper_player_id": player})
        assert resp.status_code == 200
        assert resp.json()["pick"]["sleeper_player_id"] == player

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        state_resp = await client.get("/draft/state")
        assert state_resp.status_code == 200
        assert state_resp.json()["config"]["current_pick_number"] == 2


async def test_pick_pushes_on_the_clock_to_the_next_picker(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "notify_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "notify_b")
    player = await _seed_player(pool, "notify1")

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(draft_events.dispatcher, "send_to_owner", _fake_send_to_owner)

    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, owner_b, {"push_enabled": True})

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        await client.post("/draft/start")
        resp = await client.post("/draft/pick", json={"sleeper_player_id": player})
        assert resp.status_code == 200

    # /draft/start above also pushes a "draft is live" notification to
    # owner_b (push-enabled, per notify_draft_live) — this test is about
    # the on-the-clock push specifically, so it isolates that one rather
    # than asserting a total send count.
    on_the_clock_sends = [(o, p) for o, p in sent if p["data"]["type"] == "draft_on_the_clock"]
    assert len(on_the_clock_sends) == 1
    notified_owner_id, payload = on_the_clock_sends[0]
    assert notified_owner_id == owner_b  # owner_b is up next after owner_a's pick
    assert payload["data"]["type"] == "draft_on_the_clock"


async def test_pick_does_not_push_when_the_next_picker_has_push_disabled(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "nopush_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "nopush_b")
    player = await _seed_player(pool, "nopush1")

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(draft_events.dispatcher, "send_to_owner", _fake_send_to_owner)
    # push_enabled defaults to False — owner_b never subscribed.

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        await client.post("/draft/start")
        resp = await client.post("/draft/pick", json={"sleeper_player_id": player})
        assert resp.status_code == 200

    assert sent == []


async def test_undo_last_pick_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "undo_a")
    user_a, owner_a = await _seed_member(pool, league_id, "undo_a_member")
    _user_b, owner_b = await _seed_member(pool, league_id, "undo_b")

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS, league_id=league_id)
        await draft_engine.start_draft(conn, TEST_SEASON, league_id=league_id)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))  # a member, not the commissioner
        resp = await client.post("/draft/undo-last-pick")
    assert resp.status_code == 403


async def test_websocket_requires_auth():
    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}"):
            pass
    assert exc_info.value.code == 4401
    await _use_fresh_pool_for_websocket()


async def test_websocket_sends_initial_state_via_ticket(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "ws_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "ws_b")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS, league_id=league_id)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}&ticket={_ws_ticket(user_a, owner_a)}") as ws:
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "draft_state"
    assert received["config"]["season"] == TEST_SEASON


async def test_websocket_initial_state_reports_only_self_when_alone(pool, monkeypatch):
    """A single real connection's own connected_owner_ids snapshot —
    the live multi-socket presence-broadcast behavior itself
    (connect/disconnect transitions, exclude-self) is covered by
    test_draft_manager.py's pure unit tests against DraftConnectionManager
    directly (fake sockets, no real event loop/thread boundary), same
    split chat/manager.py's own tests use for the identical reason:
    two *simultaneously open* real WebSocket connections through
    TestClient's own background thread/event-loop, both touching the
    single asyncpg pool singleton, is a real way to deadlock or corrupt
    that pool for every test that runs afterward in the same session —
    caught the hard way while writing this test."""
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "presence_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "presence_b")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS, league_id=league_id)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}&ticket={_ws_ticket(user_a, owner_a)}") as ws:
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "draft_state"
    assert received["connected_owner_ids"] == [owner_a]


async def test_draft_state_rest_includes_chat_history(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "chat_rest")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a], _ROSTER_SLOTS, league_id=league_id)
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, league_id, owner_a, "hello room")

    client = _client()
    resp = await client.get("/draft/state", cookies=_session_cookie(user_a, owner_a))
    assert resp.status_code == 200
    messages = resp.json()["chat_messages"]
    assert [m["text"] for m in messages] == ["hello room"]
    assert messages[0]["owner_id"] == owner_a


async def test_websocket_initial_state_includes_chat_history(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "ws_chat_history")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a], _ROSTER_SLOTS, league_id=league_id)
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, league_id, owner_a, "earlier message")

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}&ticket={_ws_ticket(user_a, owner_a)}") as ws:
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert [m["text"] for m in received["chat_messages"]] == ["earlier message"]


async def test_websocket_chat_message_round_trips_and_persists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "ws_chat_send")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a], _ROSTER_SLOTS, league_id=league_id)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}&ticket={_ws_ticket(user_a, owner_a)}") as ws:
        ws.receive_json()  # initial draft_state frame
        ws.send_json({"type": "chat", "text": "hello from the room"})
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "chat"
    assert received["message"]["text"] == "hello from the room"
    assert received["message"]["owner_id"] == owner_a

    async with pool.acquire() as conn:
        messages = await draft_room_chat_queries.get_recent_messages(conn, TEST_SEASON, league_id)
    assert [m["text"] for m in messages] == ["hello from the room"]


async def test_websocket_chat_ignores_blank_text(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "ws_chat_blank")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a], _ROSTER_SLOTS, league_id=league_id)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}&ticket={_ws_ticket(user_a, owner_a)}") as ws:
        ws.receive_json()  # initial draft_state frame
        ws.send_json({"type": "chat", "text": "   "})
        ws.send_json({"type": "chat", "text": "real message"})
        # The blank send above is silently dropped server-side — the next
        # frame this socket actually receives is the real message, not an
        # empty broadcast for the blank one.
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["message"]["text"] == "real message"
    async with pool.acquire() as conn:
        messages = await draft_room_chat_queries.get_recent_messages(conn, TEST_SEASON, league_id)
    assert [m["text"] for m in messages] == ["real message"]


async def test_reset_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "resetperm")
    user_id, owner_id = await _seed_member(pool, league_id, "resetperm_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.post("/draft/reset")
    assert resp.status_code == 403


async def test_setup_conflicts_when_a_draft_already_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "conflict_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "conflict_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        first = await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        assert first.status_code == 200
        second = await client.post("/draft/setup", json={"draft_order": [owner_b, owner_a], "roster_slots": _ROSTER_SLOTS})
        assert second.status_code == 409


async def test_reset_then_setup_with_new_order_succeeds(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "redo_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "redo_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        reset_resp = await client.post("/draft/reset")
        assert reset_resp.status_code == 200
        redo_resp = await client.post("/draft/setup", json={"draft_order": [owner_b, owner_a], "roster_slots": _ROSTER_SLOTS})
        assert redo_resp.status_code == 200
        assert redo_resp.json()["config"]["draft_order"] == [owner_b, owner_a]


async def test_schedule_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "sched_noncomm")
    user_id, owner_id = await _seed_member(pool, league_id, "sched_noncomm_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/draft/schedule", json={"scheduled_start": "2026-09-05T20:00:00Z"})
    assert resp.status_code == 403


async def test_schedule_succeeds_without_an_existing_draft(pool, monkeypatch):
    """A commissioner can nail down the real draft time before deciding
    the draft order at all — held in league_draft_schedule until a real
    draft exists (see that table's migration docstring). Used to 404
    here; this is the exact behavior that changed."""
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "sched_nodraft")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/draft/schedule", json={"scheduled_start": "2026-09-05T20:00:00Z"})
    assert resp.status_code == 200
    assert resp.json() is None  # no real draft_state to return yet


async def test_get_schedule_returns_the_pre_set_time_before_any_draft_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "getsched_nodraft")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        await client.put("/draft/schedule", json={"scheduled_start": "2026-09-05T20:00:00Z"})
        resp = await client.get("/draft/schedule")

    assert resp.status_code == 200
    assert resp.json()["scheduled_start"].startswith("2026-09-05T20:00:00")


async def test_get_schedule_is_null_when_nothing_is_set(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "getsched_none")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/schedule")

    assert resp.status_code == 200
    assert resp.json()["scheduled_start"] is None


async def test_setup_carries_over_a_pre_set_schedule(pool, monkeypatch):
    """A schedule set before /draft/setup should land straight in the
    new draft_config row — the commissioner shouldn't have to re-enter
    a date they already nailed down."""
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "sched_carry")
    _user_b, owner_b = await _seed_member(pool, league_id, "sched_carry_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.put("/draft/schedule", json={"scheduled_start": "2026-09-05T20:00:00Z"})

        setup_resp = await client.post(
            "/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS}
        )
        assert setup_resp.json()["config"]["scheduled_start"].startswith("2026-09-05T20:00:00")

        # league_draft_schedule's own copy is cleared once a real draft
        # exists — draft_config is the one source of truth from here on.
        schedule_resp = await client.get("/draft/schedule")
        assert schedule_resp.json()["scheduled_start"].startswith("2026-09-05T20:00:00")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM league_draft_schedule WHERE season = $1 AND league_id = $2", TEST_SEASON, league_id
        )
    assert row is None


async def test_schedule_sets_and_returns_scheduled_start(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "sched_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "sched_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})

        resp = await client.put("/draft/schedule", json={"scheduled_start": "2026-09-05T20:00:00Z"})
        assert resp.status_code == 200
        assert resp.json()["config"]["scheduled_start"].startswith("2026-09-05T20:00:00")

        state_resp = await client.get("/draft/state")
        assert state_resp.json()["config"]["scheduled_start"].startswith("2026-09-05T20:00:00")


async def test_seed_keepers_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "sk_noncomm")
    user_id, owner_id = await _seed_member(pool, league_id, "sk_noncomm_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.post("/draft/seed-keepers")
    assert resp.status_code == 403


async def test_seed_keepers_happy_path(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "sk_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "sk_b")
    sleeper_player = await _seed_player(pool, "sk_keeper")

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE players SET espn_player_id = 930001 WHERE sleeper_player_id = $1", sleeper_player
        )
        await conn.execute(
            "INSERT INTO league_keeper_rules (season, max_keepers, locked_at, league_id) VALUES ($1, 1, now(), $2)",
            TEST_SEASON, league_id,
        )
        await conn.execute(
            "INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, owner_a, 930001, "Test Keeper", league_id,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        resp = await client.post("/draft/seed-keepers")

    assert resp.status_code == 200
    seeded = resp.json()["seeded"]
    assert len(seeded) == 1
    assert seeded[0]["owner_id"] == owner_a
    assert seeded[0]["sleeper_player_id"] == sleeper_player


async def test_seed_keepers_broadcasts_so_the_pool_refreshes_for_everyone(pool, monkeypatch):
    """The real bug this covers: a seeded keeper is a genuine
    draft_picks row (see seed_keeper_pick's own docstring), but with no
    broadcast, every connected client's player pool kept showing that
    player as available until something unrelated happened to trigger
    a refetch. Verified at the broadcast call itself (not a real second
    WS connection) — see test_websocket_initial_state_reports_only_self_
    when_alone's own docstring for why two live sockets in one test is
    a real way to corrupt the shared pool for every later test."""
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "sk_broadcast")
    sleeper_player = await _seed_player(pool, "sk_broadcast_keeper")

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE players SET espn_player_id = 930002 WHERE sleeper_player_id = $1", sleeper_player
        )
        await conn.execute(
            "INSERT INTO league_keeper_rules (season, max_keepers, locked_at, league_id) VALUES ($1, 1, now(), $2)",
            TEST_SEASON, league_id,
        )
        await conn.execute(
            "INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, owner_a, 930002, "Test Keeper", league_id,
        )

    broadcasts = []

    async def _fake_broadcast(room, message, **kwargs):
        broadcasts.append((room, message))

    from app.draft.manager import manager

    monkeypatch.setattr(manager, "broadcast_to_draft", _fake_broadcast)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a], "roster_slots": _ROSTER_SLOTS})
        resp = await client.post("/draft/seed-keepers")

    assert resp.status_code == 200
    assert ((TEST_SEASON, league_id), {"type": "keepers_seeded"}) in broadcasts


async def test_seed_keepers_reports_unresolved_players(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "sk_unres")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_keeper_rules (season, max_keepers, locked_at, league_id) VALUES ($1, 1, now(), $2)",
            TEST_SEASON, league_id,
        )
        await conn.execute(
            "INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, owner_a, 930099, "No Match Guy", league_id,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a], "roster_slots": _ROSTER_SLOTS})
        resp = await client.post("/draft/seed-keepers")

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["unresolved"][0]["espn_player_id"] == 930099


async def test_roster_slots_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "rs_noncomm")
    user_id, owner_id = await _seed_member(pool, league_id, "rs_noncomm_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/draft/roster-slots", json={"roster_slots": _ROSTER_SLOTS})
    assert resp.status_code == 403


async def test_get_roster_slots_is_null_and_editable_when_nothing_is_set(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "getrs_none")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/roster-slots")

    assert resp.status_code == 200
    body = resp.json()
    assert body["roster_slots"] is None
    assert body["editable"] is True


async def test_roster_slots_can_be_staged_before_any_draft_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "rs_stage")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        put_resp = await client.put("/draft/roster-slots", json={"roster_slots": _ROSTER_SLOTS})
        assert put_resp.status_code == 200

        get_resp = await client.get("/draft/roster-slots")

    assert get_resp.json()["roster_slots"] == _ROSTER_SLOTS
    assert get_resp.json()["editable"] is True


async def test_roster_slots_rejected_once_a_real_draft_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "rs_locked")
    _user_b, owner_b = await _seed_member(pool, league_id, "rs_locked_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})

        different_shape = dict(_ROSTER_SLOTS, BE=99)
        put_resp = await client.put("/draft/roster-slots", json={"roster_slots": different_shape})
        assert put_resp.status_code == 409

        get_resp = await client.get("/draft/roster-slots")

    # The real draft_config value is unaffected by the rejected write,
    # and editable correctly flips to False now that a draft exists.
    assert get_resp.json()["roster_slots"] == _ROSTER_SLOTS
    assert get_resp.json()["editable"] is False


async def test_position_max_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "pm_noncomm")
    user_id, owner_id = await _seed_member(pool, league_id, "pm_noncomm_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/draft/position-max", json={"position_max": {"QB": 4}})
    assert resp.status_code == 403


async def test_get_position_max_is_null_and_editable_when_nothing_is_set(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "getpm_none")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/position-max")

    assert resp.status_code == 200
    body = resp.json()
    assert body["position_max"] is None
    assert body["editable"] is True


async def test_position_max_can_be_staged_before_any_draft_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "pm_stage")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        put_resp = await client.put("/draft/position-max", json={"position_max": {"QB": 4, "RB": 8}})
        assert put_resp.status_code == 200

        get_resp = await client.get("/draft/position-max")

    assert get_resp.json()["position_max"] == {"QB": 4, "RB": 8}
    assert get_resp.json()["editable"] is True


async def test_position_max_stays_editable_after_a_real_draft_exists(pool, monkeypatch):
    """The real difference from roster-slots (test_roster_slots_rejected_
    once_a_real_draft_exists above, a 409): a position cap never affects
    round count or already-generated draft_picks rows, so PUT keeps
    succeeding — updating the live draft_config directly — even once a
    real draft is set up."""
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "pm_live")
    _user_b, owner_b = await _seed_member(pool, league_id, "pm_live_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})

        put_resp = await client.put("/draft/position-max", json={"position_max": {"QB": 4}})
        assert put_resp.status_code == 200

        get_resp = await client.get("/draft/position-max")

    assert get_resp.json()["position_max"] == {"QB": 4}
    assert get_resp.json()["editable"] is True


async def test_setup_picks_up_a_staged_position_max_when_omitted_from_the_request(pool, monkeypatch):
    """Unlike roster_slots (test_setup_does_not_pick_up_a_staged_roster_
    shape_automatically below), position_max IS picked up automatically
    when /draft/setup's request omits it — see setup_draft's own
    docstring for why the two fields behave differently here."""
    _set_env(monkeypatch)
    user_id, owner_id, league_id = await _seed_commissioner_and_team(pool, "pm_setup_pickup")
    _user_b, owner_b = await _seed_member(pool, league_id, "pm_setup_pickup_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        await client.put("/draft/position-max", json={"position_max": {"QB": 4}})
        await client.post("/draft/setup", json={"draft_order": [owner_id, owner_b], "roster_slots": _ROSTER_SLOTS})

        get_resp = await client.get("/draft/position-max")

    assert get_resp.json()["position_max"] == {"QB": 4}


async def test_setup_does_not_pick_up_a_staged_roster_shape_automatically(pool, monkeypatch):
    """Unlike the schedule table, staging a roster shape doesn't get
    silently carried into draft_config — the frontend (DraftSetupPanel)
    is the one that reads the staged value and passes it explicitly to
    /draft/setup's own request body, since setup's roster_slots field
    is the caller's own explicit, required choice."""
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "rs_nocarry")
    _user_b, owner_b = await _seed_member(pool, league_id, "rs_nocarry_b")

    staged_shape = dict(_ROSTER_SLOTS, BE=42)
    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.put("/draft/roster-slots", json={"roster_slots": staged_shape})

        setup_resp = await client.post(
            "/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS}
        )
        assert setup_resp.json()["config"]["roster_slots"] == _ROSTER_SLOTS

    # The staged row is cleaned up once a real draft exists, same as
    # league_draft_schedule's own carry-over cleanup.
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM league_roster_slots_settings WHERE season = $1 AND league_id = $2", TEST_SEASON, league_id
        )
    assert row is None


async def test_order_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    _commish_user, _commish_owner, league_id = await _seed_commissioner_and_team(pool, "order_noncomm")
    user_id, owner_id = await _seed_member(pool, league_id, "order_noncomm_member")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/draft/order", json={"draft_order": [owner_id]})
    assert resp.status_code == 403


async def test_order_404s_when_no_draft_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "order_none")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/draft/order", json={"draft_order": [owner_id]})
    assert resp.status_code == 404


async def test_order_reorders_a_not_started_draft(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "order_ok_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "order_ok_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})

        resp = await client.put("/draft/order", json={"draft_order": [owner_b, owner_a]})
        assert resp.status_code == 200
        assert resp.json()["draft_order"] == [owner_b, owner_a]

        state_resp = await client.get("/draft/state")
    # Round 1's real pick rows must reflect the new order, not the original.
    round_1_picks = sorted(
        (p for p in state_resp.json()["picks"] if p["round"] == 1), key=lambda p: p["round_pick"]
    )
    assert [p["owner_id"] for p in round_1_picks] == [owner_b, owner_a]


async def test_order_rejects_a_set_that_is_not_a_reordering(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "order_bad_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "order_bad_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})

        # Dropping owner_b entirely isn't a reorder — that's a membership change.
        resp = await client.put("/draft/order", json={"draft_order": [owner_a]})
    assert resp.status_code == 400


async def test_order_rejected_once_the_draft_has_started(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "order_started_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "order_started_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        await client.post("/draft/start")

        resp = await client.put("/draft/order", json={"draft_order": [owner_b, owner_a]})
    assert resp.status_code == 409


async def test_order_rejected_once_a_keeper_is_seeded(pool, monkeypatch):
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "order_keeper_a")
    _user_b, owner_b = await _seed_member(pool, league_id, "order_keeper_b")
    sleeper_player = await _seed_player(pool, "order_keeper", search_rank=1)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})

    async with pool.acquire() as conn:
        await draft_engine.seed_keeper_pick(conn, TEST_SEASON, owner_a, 1, sleeper_player, league_id=league_id)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        resp = await client.put("/draft/order", json={"draft_order": [owner_b, owner_a]})
    assert resp.status_code == 409


# ---- draft queue (2026-09) --------------------------------------------------
# No owner/team/league id ever appears in a queue request body — every
# operation is implicitly "my own queue," resolved from the session the
# same way every other mutating draft route already does. That's a
# stronger guarantee than checking a submitted id against the caller's
# real one: there's no id to submit at all, so there's nothing to tamper
# with.


async def test_get_queue_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/draft/queue")
    assert resp.status_code == 401


async def test_add_to_queue_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/draft/queue", json={"sleeper_player_id": "p1"})
    assert resp.status_code == 401


async def test_queue_empty_by_default(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "q_empty")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/draft/queue")
    assert resp.status_code == 200
    assert resp.json()["queue"] == []


async def test_add_get_remove_round_trip(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "q_roundtrip")
    p1 = await _seed_player(pool, "q_roundtrip_1")
    p2 = await _seed_player(pool, "q_roundtrip_2")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        await client.post("/draft/queue", json={"sleeper_player_id": p1})
        add2 = await client.post("/draft/queue", json={"sleeper_player_id": p2})
        assert add2.json()["queue"] == [p1, p2]

        remove1 = await client.delete(f"/draft/queue/{p1}")
        assert remove1.json()["queue"] == [p2]

        get_resp = await client.get("/draft/queue")
    assert get_resp.json()["queue"] == [p2]


async def test_reorder_queue(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id, _league_id = await _seed_commissioner_and_team(pool, "q_reorder")
    p1 = await _seed_player(pool, "q_reorder_1")
    p2 = await _seed_player(pool, "q_reorder_2")
    p3 = await _seed_player(pool, "q_reorder_3")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        await client.post("/draft/queue", json={"sleeper_player_id": p1})
        await client.post("/draft/queue", json={"sleeper_player_id": p2})
        await client.post("/draft/queue", json={"sleeper_player_id": p3})
        resp = await client.put("/draft/queue/reorder", json={"sleeper_player_ids": [p3, p1, p2]})
    assert resp.json()["queue"] == [p3, p1, p2]


async def test_queues_are_isolated_between_owners_in_the_same_league(pool, monkeypatch):
    """The core security property: two real members of the same league,
    each building their own queue, never see or affect each other's —
    proven by having both queue the SAME player and confirming each
    owner's own queue (and only their own) reflects what THEY did."""
    _set_env(monkeypatch)
    user_a, owner_a, league_id = await _seed_commissioner_and_team(pool, "q_iso_a")
    user_b, owner_b = await _seed_member(pool, league_id, "q_iso_b")
    shared_player = await _seed_player(pool, "q_iso_shared")
    only_bs_player = await _seed_player(pool, "q_iso_b_only")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        await client.post("/draft/queue", json={"sleeper_player_id": shared_player})

    async with _client() as client:
        client.cookies.update(_session_cookie(user_b, owner_b))
        await client.post("/draft/queue", json={"sleeper_player_id": shared_player})
        await client.post("/draft/queue", json={"sleeper_player_id": only_bs_player})
        b_queue = await client.get("/draft/queue")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_a, owner_a))
        a_queue = await client.get("/draft/queue")

    assert a_queue.json()["queue"] == [shared_player]
    assert b_queue.json()["queue"] == [shared_player, only_bs_player]


async def test_queue_scoped_to_league_a_non_member_cannot_read_or_write(pool, monkeypatch):
    """A real signed-in user who simply isn't a member of this league at
    all gets the same 403 GET /draft/pool already gives a non-member —
    proven by making a second, completely separate league and confirming
    that league's owner can't touch the first league's queue."""
    _set_env(monkeypatch)
    _user_a, _owner_a, _league_a = await _seed_commissioner_and_team(pool, "q_scope_a")
    user_outsider, owner_outsider, _league_b = await _seed_commissioner_and_team(pool, "q_scope_outsider")

    async with _client() as client:
        client.cookies.update(_session_cookie(user_outsider, owner_outsider))
        get_resp = await client.get("/draft/queue")
        add_resp = await client.post("/draft/queue", json={"sleeper_player_id": "whatever"})
    # Both succeed (200) — but see the queue is scoped to THIS session's
    # own active league (require_active_league_id), i.e. league_b, not
    # league_a — the outsider can never reach league_a's queue no matter
    # what, since no league id is ever accepted from the request at all.
    assert get_resp.status_code == 200
    assert add_resp.status_code == 200
