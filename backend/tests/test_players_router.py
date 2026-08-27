from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.domain import player_card
from app.main import app

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=900000 + owner_id, is_commissioner=False
    )
    return {"session": token}


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _seed_player(pool, sleeper_id):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, 'RB', ARRAY['RB'], 'KC', 'Active', TRUE)
            """,
            sleeper_id, f"Test Player {sleeper_id}",
        )


async def test_player_card_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get("/players/whatever/card")
    assert response.status_code == 401


async def test_player_card_404s_for_unknown_player(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get("/players/test-playersrouter-nonexistent/card", cookies=_session_cookie(1))
    assert response.status_code == 404


async def test_player_card_returns_real_shaped_data(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    # Never hits real ESPN — same principle as every other test file
    # here; without this, the router's new name-based ESPN fallback
    # (see player_info.py) would fire a real network call every run.
    monkeypatch.setattr(player_card, "get_player_info", lambda espn_player_id, full_name=None: None)
    await _seed_player(pool, "test-playersrouter-1")

    response = await _get("/players/test-playersrouter-1/card", cookies=_session_cookie(1))

    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Test Player test-playersrouter-1"
    assert body["headshot_url"] == "https://sleepercdn.com/content/nfl/players/test-playersrouter-1.jpg"
