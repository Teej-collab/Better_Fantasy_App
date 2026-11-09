"""
Tests for Cheers on a chug: POST /chug/{id}/cheers toggles it, GET
/chug/feed reports who cheered and whether it's yours, and you can't
cheers your own.
"""
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON, make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_DISCORD_USER_ID = 919191


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_owner(pool, suffix, discord_user_id=None):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-chugcheers-owner-{suffix}", f"Cheers {suffix}", discord_user_id,
        )


async def _cookie_for_owner(pool, owner_id: int) -> dict:
    user_id = await make_safe_session_user_id_for_owner(pool, owner_id)
    async with pool.acquire() as conn:
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def _cleanup(pool):
    # chug_cheers goes with its chug (ON DELETE CASCADE).
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)


async def test_cheers_toggles_and_shows_on_the_feed(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    sent = []

    async def _fake_notify(conn, league_id, chug_id, chugger_owner_id, cheerer_name):
        sent.append((chug_id, chugger_owner_id, cheerer_name))

    monkeypatch.setattr("app.routers.chug.notify_chug_cheered", _fake_notify)

    chugger = await _seed_owner(pool, "chugger", _DISCORD_USER_ID)
    fan = await _seed_owner(pool, "fan")
    try:
        async with pool.acquire() as conn:
            chug_id = await conn.fetchval(
                "INSERT INTO chug_scores (discord_user_id, final_score, season, week, league_id) "
                "VALUES ($1, 8, $2, 9, $3) RETURNING id",
                _DISCORD_USER_ID, TEST_SEASON, DEFAULT_LEAGUE_ID,
            )
        fan_cookies = await _cookie_for_owner(pool, fan)
        chugger_cookies = await _cookie_for_owner(pool, chugger)

        async with _client() as client:
            client.cookies.update(fan_cookies)
            first = await client.post(f"/chug/{chug_id}/cheers")
            feed = (await client.get(f"/chug/feed?season={TEST_SEASON}")).json()["chugs"]

            client.cookies.clear()
            client.cookies.update(chugger_cookies)
            own = await client.post(f"/chug/{chug_id}/cheers")
            mine = (await client.get(f"/chug/feed?season={TEST_SEASON}")).json()["chugs"]

            client.cookies.clear()
            client.cookies.update(fan_cookies)
            second = await client.post(f"/chug/{chug_id}/cheers")
    finally:
        await _cleanup(pool)

    assert first.status_code == 200
    assert first.json()["cheered"] is True
    assert first.json()["cheers"] == [{"owner_id": fan, "name": "Cheers fan"}]
    assert sent == [(chug_id, chugger, "Cheers fan")]

    entry = next(c for c in feed if c["id"] == chug_id)
    assert entry["cheered"] is True and entry["mine"] is False
    assert [c["owner_id"] for c in entry["cheers"]] == [fan]

    assert own.status_code == 400
    own_entry = next(c for c in mine if c["id"] == chug_id)
    assert own_entry["mine"] is True and own_entry["cheered"] is False

    # Tapping again takes it back, with no second push.
    assert second.json() == {"cheered": False, "cheers": []}
    assert len(sent) == 1
