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


async def _post_sync(cookies=None, path="/admin/sync"):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.post(path)


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
