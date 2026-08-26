"""HTTP + WebSocket surface of app/routers/draft.py. Same
_use_fresh_pool_for_websocket() pattern as test_gamecast_router.py for
the WS tests (starlette's TestClient runs on its own event loop, so the
asyncpg pool singleton has to be reset around any TestClient call that
touches the DB)."""
import itertools

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from app import db as db_module
from app.auth.session import create_session_token, create_ticket_token
from app.domain import draft_engine
from app.main import app
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}
_espn_team_id_counter = itertools.count(910001)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int, is_commissioner: bool = False):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=300000 + owner_id, is_commissioner=is_commissioner
    )
    return {"session": token}


def _ws_ticket(owner_id: int):
    return create_ticket_token(
        _SESSION_SECRET, purpose="ws", user_id=1, owner_id=owner_id,
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


async def _seed_owner_and_team(pool, suffix):
    espn_team_id = next(_espn_team_id_counter)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-draftrouter-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return owner_id


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
    owner_id = await _seed_owner_and_team(pool, "pool1")
    player = await _seed_player(pool, "p1")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/draft/pool")

    assert resp.status_code == 200
    ids = {p["sleeper_player_id"] for p in resp.json()["players"]}
    assert player in ids


async def test_setup_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_id = await _seed_owner_and_team(pool, "setup1")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id, is_commissioner=False))
        resp = await client.post("/draft/setup", json={
            "draft_order": [owner_id], "roster_slots": _ROSTER_SLOTS,
        })
    assert resp.status_code == 403


async def test_setup_and_start_and_pick_flow(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_a = await _seed_owner_and_team(pool, "flow_a")
    owner_b = await _seed_owner_and_team(pool, "flow_b")
    player = await _seed_player(pool, "flow1")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a, is_commissioner=True))
        setup_resp = await client.post("/draft/setup", json={
            "draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS,
        })
        assert setup_resp.status_code == 200

        start_resp = await client.post("/draft/start")
        assert start_resp.status_code == 200
        assert start_resp.json()["config"]["current_pick_number"] == 1

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_b))  # not on the clock
        resp = await client.post("/draft/pick", json={"sleeper_player_id": player})
        assert resp.status_code == 409

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a))
        resp = await client.post("/draft/pick", json={"sleeper_player_id": player})
        assert resp.status_code == 200
        assert resp.json()["pick"]["sleeper_player_id"] == player

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a))
        state_resp = await client.get("/draft/state")
        assert state_resp.status_code == 200
        assert state_resp.json()["config"]["current_pick_number"] == 2


async def test_undo_last_pick_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_a = await _seed_owner_and_team(pool, "undo_a")
    owner_b = await _seed_owner_and_team(pool, "undo_b")

    pool_conn_pool = pool
    async with pool_conn_pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        await draft_engine.start_draft(conn, TEST_SEASON)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a, is_commissioner=False))
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
    owner_a = await _seed_owner_and_team(pool, "ws_a")
    owner_b = await _seed_owner_and_team(pool, "ws_b")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/draft/ws?season={TEST_SEASON}&ticket={_ws_ticket(owner_a)}") as ws:
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "draft_state"
    assert received["config"]["season"] == TEST_SEASON


async def test_reset_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_id = await _seed_owner_and_team(pool, "resetperm")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id, is_commissioner=False))
        resp = await client.post("/draft/reset")
    assert resp.status_code == 403


async def test_setup_conflicts_when_a_draft_already_exists(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_a = await _seed_owner_and_team(pool, "conflict_a")
    owner_b = await _seed_owner_and_team(pool, "conflict_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a, is_commissioner=True))
        first = await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        assert first.status_code == 200
        second = await client.post("/draft/setup", json={"draft_order": [owner_b, owner_a], "roster_slots": _ROSTER_SLOTS})
        assert second.status_code == 409


async def test_reset_then_setup_with_new_order_succeeds(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_a = await _seed_owner_and_team(pool, "redo_a")
    owner_b = await _seed_owner_and_team(pool, "redo_b")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a, is_commissioner=True))
        await client.post("/draft/setup", json={"draft_order": [owner_a, owner_b], "roster_slots": _ROSTER_SLOTS})
        reset_resp = await client.post("/draft/reset")
        assert reset_resp.status_code == 200
        redo_resp = await client.post("/draft/setup", json={"draft_order": [owner_b, owner_a], "roster_slots": _ROSTER_SLOTS})
        assert redo_resp.status_code == 200
        assert redo_resp.json()["config"]["draft_order"] == [owner_b, owner_a]
