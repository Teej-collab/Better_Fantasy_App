"""
REST + WebSocket surface of app/routers/gamecast.py, against the mock
provider (the one actually running in this environment — no
SPORTRADAR_API_KEY is configured anywhere in tests). Uses the same
_use_fresh_pool_for_websocket() pattern as tests/test_chat.py's own
WebSocket tests: starlette's TestClient runs the ASGI app on its own
event loop in a background thread, and asyncpg's pool is bound to
whichever loop created it, so the module-level pool singleton has to be
reset around any TestClient-based (as opposed to httpx.AsyncClient/
ASGITransport-based) call that touches the DB.
"""
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from app import db as db_module
from app.auth.session import create_session_token, create_ticket_token
from app.gamecast import service
from app.main import app

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _use_fresh_pool_for_websocket():
    # Hands the outgoing pool off to conftest's _pending_pool_close
    # instead of closing it here directly — see test_chat.py's own
    # _use_fresh_pool_for_websocket for the full explanation of why
    # (closing it immediately would break this same test's own
    # cleanup_test_season teardown, which is still holding a reference
    # to it). conftest.py's `pool` fixture closes it for us at the
    # start of the next test that requests a pool.
    # Bare `import conftest` — see test_chat.py's own
    # _use_fresh_pool_for_websocket for why a dotted `tests.conftest`
    # import doesn't work here (no tests/__init__.py).
    import conftest

    if db_module._pool is not None:
        conftest._pending_pool_close.append(db_module._pool)
    db_module._pool = None


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=200000 + owner_id, is_commissioner=False
    )
    return {"session": token}


def _ws_ticket(owner_id: int):
    return create_ticket_token(
        _SESSION_SECRET, purpose="ws", user_id=1, owner_id=owner_id,
        discord_user_id=200000 + owner_id, is_commissioner=False,
    )


async def test_live_games_lists_the_mock_games_with_no_auth_required():
    async with _client() as client:
        resp = await client.get("/nfl/live-games")

    assert resp.status_code == 200
    games = resp.json()["games"]
    ids = {g["game_id"] for g in games}
    assert ids == {"mock-kc-buf", "mock-sf-dal"}
    for g in games:
        assert g["status"] in ("scheduled", "in_progress", "halftime", "final")
        assert "home_team" in g and "away_team" in g


async def test_game_state_returns_full_normalized_shape_for_a_known_mock_game():
    async with _client() as client:
        resp = await client.get("/nfl/games/mock-kc-buf")

    assert resp.status_code == 200
    game = resp.json()
    assert game["game_id"] == "mock-kc-buf"
    assert game["provider"] == "mock"
    assert game["home_team"]["abbr"] == "KC"
    assert game["away_team"]["abbr"] == "BUF"
    # Full-shape fields the summary list deliberately omits.
    for field in ("possession_team_abbr", "down", "distance", "yards_to_goal", "drives", "plays", "scoring_plays"):
        assert field in game


async def test_game_state_404s_for_an_unknown_game_id():
    async with _client() as client:
        resp = await client.get("/nfl/games/does-not-exist")

    assert resp.status_code == 404


async def test_websocket_requires_auth():
    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    # No session cookie, no ticket — the server closes the handshake with
    # 4401 before it's ever accepted, which the test client surfaces as a
    # WebSocketDisconnect right at connect time, not from a later receive.
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/nfl/gamecast/ws?game_id=mock-kc-buf"):
            pass
    assert exc_info.value.code == 4401
    await _use_fresh_pool_for_websocket()


async def test_websocket_sends_initial_game_state_via_session_cookie(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)

    async def _seed_owner(suffix):
        async with pool.acquire() as conn:
            return await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-gamecast-ws-owner-{suffix}", f"Watcher {suffix}",
            )

    owner_id = await _seed_owner(1)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/nfl/gamecast/ws?game_id=mock-kc-buf", cookies=_session_cookie(owner_id)) as ws:
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "game_state"
    assert received["game"]["game_id"] == "mock-kc-buf"


async def test_websocket_authenticates_via_ticket_when_no_session_cookie(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)

    async def _seed_owner(suffix):
        async with pool.acquire() as conn:
            return await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-gamecast-ws-owner-{suffix}", f"Watcher {suffix}",
            )

    owner_id = await _seed_owner(2)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect(f"/nfl/gamecast/ws?game_id=mock-kc-buf&ticket={_ws_ticket(owner_id)}") as ws:
        received = ws.receive_json()
    await _use_fresh_pool_for_websocket()

    assert received["type"] == "game_state"


async def test_fantasy_impact_works_signed_out_with_game_leaders_only():
    async with _client() as client:
        resp = await client.get("/nfl/games/mock-kc-buf/fantasy-impact")

    assert resp.status_code == 200
    body = resp.json()
    assert body["your_team"] is None
    assert body["your_players"] == []
    assert body["opponent_team"] is None
    assert body["opponent_players"] == []
    assert body["game_leaders"]["home"]["abbr"] == "KC"
    assert body["game_leaders"]["away"]["abbr"] == "BUF"


async def test_fantasy_impact_404s_for_an_unknown_game_id():
    async with _client() as client:
        resp = await client.get("/nfl/games/does-not-exist/fantasy-impact")

    assert resp.status_code == 404


async def test_websocket_closes_with_4404_for_an_unknown_game_id(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)

    async def _seed_owner(suffix):
        async with pool.acquire() as conn:
            return await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-gamecast-ws-owner-{suffix}", f"Watcher {suffix}",
            )

    owner_id = await _seed_owner(3)
    service._current_state.pop("does-not-exist", None)

    await _use_fresh_pool_for_websocket()
    client = TestClient(app)
    with client.websocket_connect("/nfl/gamecast/ws?game_id=does-not-exist", cookies=_session_cookie(owner_id)) as ws:
        received = ws.receive_json()
        assert received == {"type": "error", "detail": "Unknown game_id"}
    await _use_fresh_pool_for_websocket()
