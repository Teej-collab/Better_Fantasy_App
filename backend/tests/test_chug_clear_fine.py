from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(user_id: int, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=999,
        is_commissioner=False,  # ignored by the router now — real per-league check instead
    )
    return {"session": token}


async def _seed_owner(pool, suffix, fined_owed=0):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-clearfine-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, fined_owed) VALUES ($1, $2, $3)",
            TEST_SEASON, owner_id, fined_owed,
        )
    return owner_id


async def _member_cookies(pool, suffix: str) -> dict:
    """A real DEFAULT_LEAGUE_ID member, not commissioner — clear-fine
    now does a live require_league_commissioner check (app/auth/
    league_context.py, see TODO.md's PHASE 9 entry), not the old JWT
    is_commissioner claim, so a genuine "rejects" test needs a real
    member who really isn't the commissioner."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Test Clear Fine Member') "
            "RETURNING id",
            f"test-clearfine-{suffix}@example.com",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-clearfine-owner-{suffix}", f"Owner {suffix}", user_id,
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id, owner_id)


async def _commissioner_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Test Clear Fine Commish') "
            "RETURNING id",
            f"test-clearfine-{suffix}@example.com",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-clearfine-owner-{suffix}", f"Owner {suffix}", user_id,
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id, owner_id)


async def test_clear_fine_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/chug/standing/1/clear-fine")
    assert resp.status_code == 401


async def test_clear_fine_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 1, fined_owed=3)

    async with _client() as client:
        client.cookies.update(await _member_cookies(pool, "reject"))
        resp = await client.post(f"/chug/standing/{owner_id}/clear-fine")

    assert resp.status_code == 403


async def test_commissioner_can_clear_a_fine(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 3, fined_owed=3)

    async with _client() as client:
        client.cookies.update(await _commissioner_cookies(pool, "commish"))
        resp = await client.post(f"/chug/standing/{owner_id}/clear-fine", params={"amount": 2})

    async with pool.acquire() as conn:
        fined = await conn.fetchval(
            "SELECT fined_owed FROM chug_standing WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_id
        )

    assert resp.status_code == 200
    assert resp.json() == {"owner_id": owner_id, "cleared": 2}
    assert fined == 1
