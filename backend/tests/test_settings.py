from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=123, is_commissioner=False
    )
    return {"session": token}


async def _seed_owner(pool, suffix, discord_username=None):
    async with pool.acquire() as conn:
        user_id = None
        if discord_username is not None:
            user_id = await conn.fetchval(
                "INSERT INTO users (discord_username) VALUES ($1) RETURNING id", discord_username
            )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-settings-owner-{suffix}", f"Owner {suffix}", user_id,
        )
    return owner_id


async def _cleanup_user(pool, owner_id):
    async with pool.acquire() as conn:
        user_id = await conn.fetchval("SELECT user_id FROM owners WHERE owner_id = $1", owner_id)
        if user_id:
            await conn.execute("UPDATE owners SET user_id = NULL WHERE owner_id = $1", owner_id)
            await conn.execute("DELETE FROM users WHERE id = $1", user_id)


async def test_get_settings_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/settings/me")
    assert resp.status_code == 401


async def test_get_settings_returns_defaults(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1, discord_username="teej_8")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/settings/me")

    await _cleanup_user(pool, owner_id)

    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Owner 1"
    assert body["display_name_is_custom"] is False
    assert body["chat_color"] is None
    assert body["discord_username"] == "teej_8"


async def test_update_display_name(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 2)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/display-name", json={"display_name": "  The Commissioner  "})

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT display_name, display_name_is_custom FROM owners WHERE owner_id = $1", owner_id
        )

    assert resp.status_code == 200
    assert row["display_name"] == "The Commissioner"  # trimmed
    assert row["display_name_is_custom"] is True


async def test_update_display_name_rejects_empty(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 3)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/display-name", json={"display_name": "   "})

    assert resp.status_code == 400


async def test_update_display_name_rejects_too_long(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 4)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/display-name", json={"display_name": "x" * 41})

    assert resp.status_code == 400


async def test_reset_display_name_lets_next_sync_restore_it(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 5)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        await client.put("/settings/display-name", json={"display_name": "Custom Name"})
        resp = await client.post("/settings/display-name/reset")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT display_name, display_name_is_custom FROM owners WHERE owner_id = $1", owner_id
        )

    assert resp.status_code == 200
    assert row["display_name"] == "Custom Name"  # unchanged until the next sync
    assert row["display_name_is_custom"] is False  # but the flag is cleared, so the next sync will overwrite it


async def test_update_chat_color_accepts_valid_hex(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 6)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/chat-color", json={"chat_color": "#39ff6a"})

    async with pool.acquire() as conn:
        color = await conn.fetchval("SELECT chat_color FROM owners WHERE owner_id = $1", owner_id)

    assert resp.status_code == 200
    assert color == "#39ff6a"


async def test_update_chat_color_rejects_non_hex(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 7)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        for bad in ["red", "#zzzzzz", "#fff", "39ff6a", "#39ff6a; } * { display:none"]:
            resp = await client.put("/settings/chat-color", json={"chat_color": bad})
            assert resp.status_code == 400, bad


async def test_update_chat_color_null_resets_to_default(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 8)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        await client.put("/settings/chat-color", json={"chat_color": "#39ff6a"})
        resp = await client.put("/settings/chat-color", json={"chat_color": None})

    async with pool.acquire() as conn:
        color = await conn.fetchval("SELECT chat_color FROM owners WHERE owner_id = $1", owner_id)

    assert resp.status_code == 200
    assert color is None


async def _seed_team(pool, owner_id, suffix, season):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 900 + suffix, owner_id, f"Team {suffix}",
        )


async def test_update_team_name(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 11)
    await _seed_team(pool, owner_id, 11, TEST_SEASON)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/team-name", json={"team_name": "  The Replacements  "})

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT team_name, team_name_is_custom FROM teams_by_season WHERE owner_id = $1 AND season = $2",
            owner_id, TEST_SEASON,
        )

    assert resp.status_code == 200
    assert row["team_name"] == "The Replacements"  # trimmed
    assert row["team_name_is_custom"] is True


async def test_update_team_name_rejects_empty(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 12)
    await _seed_team(pool, owner_id, 12, TEST_SEASON)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/team-name", json={"team_name": "   "})

    assert resp.status_code == 400


async def test_update_team_name_rejects_too_long(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 13)
    await _seed_team(pool, owner_id, 13, TEST_SEASON)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/team-name", json={"team_name": "x" * 41})

    assert resp.status_code == 400


async def test_update_team_name_404s_when_owner_has_no_team_this_season(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 14)  # no teams_by_season row seeded

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/team-name", json={"team_name": "New Name"})

    assert resp.status_code == 404


async def test_reset_team_name_lets_next_sync_restore_it(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 15)
    await _seed_team(pool, owner_id, 15, TEST_SEASON)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        await client.put("/settings/team-name", json={"team_name": "Custom Team"})
        resp = await client.post("/settings/team-name/reset")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT team_name, team_name_is_custom FROM teams_by_season WHERE owner_id = $1 AND season = $2",
            owner_id, TEST_SEASON,
        )

    assert resp.status_code == 200
    assert row["team_name"] == "Custom Team"  # unchanged until the next sync
    assert row["team_name_is_custom"] is False  # but the flag is cleared, so the next sync will overwrite it


async def test_owner_can_only_ever_modify_their_own_settings(pool, monkeypatch):
    """No route accepts an owner_id — the session is the only identity
    source — so two owners' settings genuinely can't collide no matter
    what either client sends."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a = await _seed_owner(pool, 9)
    owner_b = await _seed_owner(pool, 10)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_a))
        await client.put("/settings/display-name", json={"display_name": "Owner A's Name"})

    async with pool.acquire() as conn:
        name_a = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_a)
        name_b = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_b)

    assert name_a == "Owner A's Name"
    assert name_b == "Owner 10"  # untouched
