from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import leagues as league_queries
from app.config import DEFAULT_LEAGUE_ID

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=900000 + owner_id,
        is_commissioner=False,  # ignored by the router now — real per-league check instead
    )
    return {"session": token}


async def _make_user(conn, suffix: str) -> int:
    return await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-admin-{suffix}@example.com", f"Test Admin {suffix}",
    )


async def _non_commissioner_cookies(pool, suffix: str) -> dict:
    """A real, isolated test user who is not a League #1 commissioner —
    admin.py's routes gate on require_commissioner_of(DEFAULT_LEAGUE_ID)
    specifically, a live DB check (see TODO.md's PHASE 9 entry), not
    the old JWT is_commissioner claim these tests used to fake. Using
    a real but unaffiliated user (rather than the real production
    commissioner's own user_id) keeps a "rejects" test from silently
    succeeding — and, worse, actually firing a real unmocked ESPN
    sync — just because it happened to reuse a real commissioner's id."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
    return _session_cookie(user_id, owner_id=1)


async def _commissioner_of_league_one_cookies(pool, suffix: str) -> dict:
    """A real test user actually made League #1's commissioner for the
    duration of one test — the only way to legitimately exercise the
    success path now that this is a live per-league DB check rather
    than a JWT flag. Cleaned up by conftest's league_members-by-user
    sweep (this user's email matches 'test-%')."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id, owner_id=1)


async def _post_sync(cookies=None, path="/admin/sync", json=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.post(path, json=json)


async def _get(cookies=None, path="/admin/online"):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def test_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync()
    assert response.status_code == 401


async def test_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(cookies=await _non_commissioner_cookies(pool, "sync-reject"))
    assert response.status_code == 403


async def test_live_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/sync/live")
    assert response.status_code == 401


async def test_live_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "live-sync-reject"), path="/admin/sync/live"
    )
    assert response.status_code == 403


async def test_weekly_compute_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/weekly-compute")
    assert response.status_code == 401


async def test_weekly_compute_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "weekly-compute-reject"), path="/admin/weekly-compute"
    )
    assert response.status_code == 403


async def test_bye_week_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/sync/bye-weeks")
    assert response.status_code == 401


async def test_bye_week_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "bye-week-reject"), path="/admin/sync/bye-weeks"
    )
    assert response.status_code == 403


async def test_bye_week_sync_writes_real_rows(pool, monkeypatch):
    from app.domain import bye_weeks as bye_weeks_module
    from tests.conftest import TEST_SEASON

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")

    async def fake_scoreboard(week, year, season_type=None):
        return [{"home_team": "KC", "away_team": "SF"}] if week == 1 else [{"home_team": "SF", "away_team": "ZZZ"}]

    monkeypatch.setattr(bye_weeks_module, "get_week_scoreboard", fake_scoreboard)
    monkeypatch.setattr(bye_weeks_module, "REGULAR_SEASON_WEEKS", 2)

    response = await _post_sync(
        cookies=await _commissioner_of_league_one_cookies(pool, "bye-week-writer"), path="/admin/sync/bye-weeks"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["teams_synced"] == 1  # only KC has exactly one missing week in this fixture


async def test_projected_points_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/players/sync-projections")
    assert response.status_code == 401


async def test_projected_points_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "proj-sync-reject"), path="/admin/players/sync-projections"
    )
    assert response.status_code == 403


async def test_projected_points_sync_writes_real_rows(pool, monkeypatch):
    from app.domain import player_projections

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, is_draftable) "
            "VALUES ('test-admin-proj-player', 777001, 'Test Admin Proj Player', 'RB', TRUE)"
        )

    monkeypatch.setattr(
        player_projections,
        "get_all_projected_points",
        lambda config=None, season=None: [
            {"espn_player_id": 777001, "name": "Test Admin Proj Player", "projected_points": 199.9}
        ],
    )

    response = await _post_sync(
        cookies=await _commissioner_of_league_one_cookies(pool, "proj-sync-writer"),
        path="/admin/players/sync-projections",
    )

    assert response.status_code == 200
    assert response.json()["matched_by_espn_id"] == 1

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT projected_points FROM players WHERE sleeper_player_id = 'test-admin-proj-player'"
        )
    assert float(row["projected_points"]) == 199.9


# ---- Usage dashboard (2026-09) --------------------------------------


class _FakeSocket:
    async def accept(self):
        pass

    async def send_json(self, message):
        pass


async def test_online_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/online")
    assert response.status_code == 401


async def test_online_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "online-reject"), path="/admin/online")
    assert response.status_code == 403


async def test_online_reports_username_only_for_connected_owners(pool, monkeypatch):
    from app.chat.manager import manager as chat_manager

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-admin-online-owner", "Online Owner",
        )

    await chat_manager.connect(owner_id, _FakeSocket())
    try:
        response = await _get(
            cookies=await _commissioner_of_league_one_cookies(pool, "online-reader"), path="/admin/online"
        )
    finally:
        await chat_manager.disconnect(owner_id, list(chat_manager._connections[owner_id])[0])

    assert response.status_code == 200
    owners = response.json()["owners"]
    assert owners == [{"owner_id": owner_id, "display_name": "Online Owner"}]


async def test_track_view_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/track-view", json={"path": "/standings"})
    assert response.status_code == 401


async def test_track_view_records_a_real_row(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track-view")
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-admin-trackview-owner", "Track View Owner", user_id,
        )
    cookies = _session_cookie(user_id, owner_id)

    response = await _post_sync(cookies=cookies, path="/admin/track-view", json={"path": "/standings"})
    assert response.status_code == 200

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT path FROM page_view_events WHERE owner_id = $1", owner_id
        )
    assert row["path"] == "/standings"


async def test_track_view_is_a_noop_without_an_owner_id(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track-view-noowner")
    token = create_session_token(_SESSION_SECRET, user_id=user_id)  # no owner_id — hasn't joined a league yet

    response = await _post_sync(
        cookies={"session": token}, path="/admin/track-view", json={"path": "/test-admin-noowner-path"}
    )
    assert response.status_code == 200

    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM page_view_events WHERE path = '/test-admin-noowner-path'"
        )
    assert count == 0


async def test_usage_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/usage")
    assert response.status_code == 401


async def test_usage_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "usage-reject"), path="/admin/usage")
    assert response.status_code == 403


async def test_usage_summarizes_real_views(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-admin-usage-owner", "Usage Owner",
        )
        await conn.execute(
            "INSERT INTO page_view_events (owner_id, path) VALUES ($1, '/standings'), ($1, '/standings'), ($1, '/chat')",
            owner_id,
        )

    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "usage-reader"), path="/admin/usage?days=7"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["window_days"] == 7
    top = {row["path"]: row["views"] for row in body["top_paths"]}
    assert top["/standings"] == 2
    assert top["/chat"] == 1
