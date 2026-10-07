"""The Punishment Wheel (app/routers/punishment_wheel.py)."""
import pytest

from app.routers import punishment_wheel
from tests.conftest import TEST_SEASON
from tests.test_chat import _SESSION_SECRET, _client, _league_session_cookie, _seed_league_owner


@pytest.fixture
def quiet(monkeypatch):
    calls = {"broadcast": [], "push": []}

    async def fake_broadcast(owner_ids, message):
        calls["broadcast"].append(message)

    async def fake_push(conn, owner_id, payload):
        calls["push"].append(owner_id)

    async def push_on(conn, owner_id):
        return {"push_enabled": True, "notify_league": True}

    monkeypatch.setattr(punishment_wheel.manager, "broadcast_to_owners", fake_broadcast)
    monkeypatch.setattr(punishment_wheel.dispatcher, "send_to_owner", fake_push)
    monkeypatch.setattr(punishment_wheel.preferences_queries, "get_preferences", push_on)
    return calls


async def _cleanup(pool, league_id):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM season_punishments WHERE league_id = $1", league_id)
        await conn.execute("DELETE FROM punishment_wheel_items WHERE league_id = $1", league_id)


async def test_commissioner_builds_and_spins_once_members_watch(pool, monkeypatch, quiet):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    c_user, c_owner, league_id = await _seed_league_owner(pool, 901, role="commissioner")
    m_user, m_owner, _ = await _seed_league_owner(pool, 902, league_id=league_id)
    commish = _league_session_cookie(c_user, c_owner)
    member = _league_session_cookie(m_user, m_owner)
    try:
        async with _client() as client:
            client.cookies.update(member)
            denied_add = await client.post("/punishment-wheel/items", json={"text": "Nope"})
            denied_spin = await client.post("/punishment-wheel/spin")

            client.cookies.update(commish)
            too_few = await client.post("/punishment-wheel/spin")
            for text in ("Take the SAT", "24 hours in a Waffle House", "Run a 5K in a costume"):
                await client.post("/punishment-wheel/items", json={"text": text})
            spun = await client.post("/punishment-wheel/spin")
            again = await client.post("/punishment-wheel/spin")
            locked = await client.post("/punishment-wheel/items", json={"text": "Too late"})

            client.cookies.update(member)
            seen = (await client.get("/punishment-wheel")).json()

        assert denied_add.status_code == 403 and denied_spin.status_code == 403
        assert too_few.status_code == 409
        assert spun.status_code == 200
        result = spun.json()["result"]
        assert result["items"] == ["Take the SAT", "24 hours in a Waffle House", "Run a 5K in a costume"]
        assert result["text"] == result["items"][result["landed_index"]]
        assert again.status_code == 409 and locked.status_code == 409
        assert seen["result"]["text"] == result["text"] and seen["can_spin"] is False and seen["can_edit"] is False
        assert quiet["broadcast"][0]["type"] == "wheel_spin"
        assert m_owner in quiet["push"] and c_owner not in quiet["push"]
    finally:
        await _cleanup(pool, league_id)


async def test_remove_before_spin(pool, monkeypatch, quiet):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    c_user, c_owner, league_id = await _seed_league_owner(pool, 903, role="commissioner")
    try:
        async with _client() as client:
            client.cookies.update(_league_session_cookie(c_user, c_owner))
            added = (await client.post("/punishment-wheel/items", json={"text": "Take the SAT"})).json()
            item_id = added["items"][0]["id"]
            after = (await client.delete(f"/punishment-wheel/items/{item_id}")).json()
        assert after["items"] == []
    finally:
        await _cleanup(pool, league_id)
