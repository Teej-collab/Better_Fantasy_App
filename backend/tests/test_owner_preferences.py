import datetime

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import owner_preferences as preferences_queries

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=100000 + owner_id, is_commissioner=False
    )
    return {"session": token}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-ownerprefs-owner-{suffix}", f"Owner {suffix}",
        )


# ---- query-layer tests -----------------------------------------------------


async def test_get_preferences_returns_defaults_with_no_row(pool):
    owner_id = await _seed_owner(pool, 1)
    async with pool.acquire() as conn:
        prefs = await preferences_queries.get_preferences(conn, owner_id)

    assert prefs["notify_direct_messages"] is True
    assert prefs["notify_league_chat"] is True
    assert prefs["sunday_mode"] is None
    assert prefs["quiet_hours_enabled"] is False
    assert prefs["quiet_hours_start"] == datetime.time(22, 0)
    assert prefs["read_receipts_enabled"] is True
    assert prefs["neon_intensity"] == "standard"


async def test_update_preferences_creates_row_and_applies_only_the_patch(pool):
    owner_id = await _seed_owner(pool, 2)
    async with pool.acquire() as conn:
        updated = await preferences_queries.update_preferences(conn, owner_id, {"typing_indicators_enabled": False})

    assert updated["typing_indicators_enabled"] is False
    # everything else untouched, still the real default
    assert updated["read_receipts_enabled"] is True
    assert updated["notify_league_chat"] is True

    async with pool.acquire() as conn:
        reread = await preferences_queries.get_preferences(conn, owner_id)
    assert reread["typing_indicators_enabled"] is False


async def test_update_preferences_second_patch_does_not_clobber_first(pool):
    owner_id = await _seed_owner(pool, 3)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(conn, owner_id, {"read_receipts_enabled": False})
        second = await preferences_queries.update_preferences(conn, owner_id, {"message_previews_enabled": False})

    assert second["read_receipts_enabled"] is False  # from the first patch, still applied
    assert second["message_previews_enabled"] is False  # from this patch


async def test_directly_editing_a_messages_toggle_clears_sunday_mode(pool):
    owner_id = await _seed_owner(pool, 4)
    async with pool.acquire() as conn:
        after_preset = await preferences_queries.apply_sunday_mode(conn, owner_id, "full_send")
        assert after_preset["sunday_mode"] == "full_send"

        after_hand_edit = await preferences_queries.update_preferences(conn, owner_id, {"notify_league_chat": False})

    assert after_hand_edit["sunday_mode"] is None
    assert after_hand_edit["notify_league_chat"] is False
    assert after_hand_edit["notify_direct_messages"] is True  # untouched by the hand-edit


async def test_apply_sunday_mode_game_day_sets_expected_toggles(pool):
    owner_id = await _seed_owner(pool, 5)
    async with pool.acquire() as conn:
        result = await preferences_queries.apply_sunday_mode(conn, owner_id, "game_day")

    assert result["sunday_mode"] == "game_day"
    assert result["notify_direct_messages"] is True
    assert result["notify_mentions"] is True
    assert result["notify_league_chat"] is False
    assert result["notify_replies"] is False


# ---- router-layer tests -----------------------------------------------------


async def test_get_preferences_requires_session():
    async with _client() as client:
        resp = await client.get("/settings/preferences")
    assert resp.status_code == 401


async def test_put_preferences_partial_patch_end_to_end(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 6)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/preferences", json={"neon_intensity": "high", "reduced_motion": True})

    assert resp.status_code == 200
    body = resp.json()
    assert body["neon_intensity"] == "high"
    assert body["reduced_motion"] is True
    assert body["notify_direct_messages"] is True  # unpatched fields still present, still default


async def test_put_preferences_rejects_invalid_neon_intensity(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 7)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/preferences", json={"neon_intensity": "extremely-loud"})

    assert resp.status_code == 400


async def test_put_preferences_sets_and_clears_accent_color(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 11)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/preferences", json={"accent_color": "#0ea5e9"})
        assert resp.status_code == 200
        assert resp.json()["accent_color"] == "#0ea5e9"

        # null clears back to "use the app default" — not a no-op patch.
        resp = await client.put("/settings/preferences", json={"accent_color": None})
        assert resp.status_code == 200
        assert resp.json()["accent_color"] is None


async def test_put_preferences_rejects_invalid_accent_color(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 12)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.put("/settings/preferences", json={"accent_color": "not-a-color"})

    assert resp.status_code == 400


async def test_sunday_mode_endpoint_rejects_unknown_preset(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 8)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/settings/preferences/sunday-mode", json={"preset": "vibes_only"})

    assert resp.status_code == 400


async def test_sunday_mode_endpoint_applies_full_send(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 9)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/settings/preferences/sunday-mode", json={"preset": "full_send"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["sunday_mode"] == "full_send"
    assert body["notify_league_chat"] is True
