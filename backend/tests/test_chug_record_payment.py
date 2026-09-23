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
        is_commissioner=False,  # ignored by the router now -- real per-league check instead
    )
    return {"session": token}


async def _seed_owner(pool, suffix, outstanding_owed=0):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-recordpay-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, $3)",
            TEST_SEASON, owner_id, outstanding_owed,
        )
    return owner_id


async def _member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Test Record Payment Member') "
            "RETURNING id",
            f"test-recordpay-{suffix}@example.com",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-recordpay-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id, owner_id)


async def _commissioner_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Test Record Payment Commish') "
            "RETURNING id",
            f"test-recordpay-{suffix}@example.com",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-recordpay-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id, owner_id)


async def test_record_payment_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/chug/standing/1/record-payment")
    assert resp.status_code == 401


async def test_record_payment_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 1, outstanding_owed=2)

    async with _client() as client:
        client.cookies.update(await _member_cookies(pool, "reject"))
        resp = await client.post(f"/chug/standing/{owner_id}/record-payment")

    assert resp.status_code == 403


async def test_commissioner_can_record_a_payment(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 2, outstanding_owed=2)

    async with _client() as client:
        client.cookies.update(await _commissioner_cookies(pool, "commish"))
        resp = await client.post(f"/chug/standing/{owner_id}/record-payment", params={"amount": 1})

    async with pool.acquire() as conn:
        outstanding = await conn.fetchval(
            "SELECT outstanding_owed FROM chug_standing WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_id
        )

    assert resp.status_code == 200
    assert resp.json() == {"owner_id": owner_id, "applied": 1}
    assert outstanding == 1


async def test_record_payment_clamps_to_what_was_actually_owed(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 3, outstanding_owed=1)

    async with _client() as client:
        client.cookies.update(await _commissioner_cookies(pool, "commish2"))
        resp = await client.post(f"/chug/standing/{owner_id}/record-payment", params={"amount": 5})

    async with pool.acquire() as conn:
        outstanding = await conn.fetchval(
            "SELECT outstanding_owed FROM chug_standing WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_id
        )

    assert resp.status_code == 200
    assert resp.json() == {"owner_id": owner_id, "applied": 1}
    assert outstanding == 0
