from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int, is_commissioner: bool):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=999, is_commissioner=is_commissioner
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


async def test_clear_fine_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/chug/standing/1/clear-fine")
    assert resp.status_code == 401


async def test_clear_fine_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 1, fined_owed=3)
    other_owner_id = await _seed_owner(pool, 2)

    async with _client() as client:
        client.cookies.update(_session_cookie(other_owner_id, is_commissioner=False))
        resp = await client.post(f"/chug/standing/{owner_id}/clear-fine")

    assert resp.status_code == 403


async def test_commissioner_can_clear_a_fine(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 3, fined_owed=3)
    commissioner_id = await _seed_owner(pool, 4)

    async with _client() as client:
        client.cookies.update(_session_cookie(commissioner_id, is_commissioner=True))
        resp = await client.post(f"/chug/standing/{owner_id}/clear-fine", params={"amount": 2})

    async with pool.acquire() as conn:
        fined = await conn.fetchval(
            "SELECT fined_owed FROM chug_standing WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_id
        )

    assert resp.status_code == 200
    assert resp.json() == {"owner_id": owner_id, "cleared": 2}
    assert fined == 1
