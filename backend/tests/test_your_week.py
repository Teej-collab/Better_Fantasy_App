from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.domain.your_week import build_your_week
from app.main import app
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=999, is_commissioner=False
    )
    return {"session": token}


async def _seed_owner_and_team(pool, season=TEST_SEASON):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-yourweek-owner", "Alice",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 1, owner_id, "Team Alpha",
        )
    return owner_id, team_id


async def test_no_team_in_active_season_returns_none(pool):
    owner_id, _ = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        result = await build_your_week(conn, owner_id, season=TEST_SEASON + 1)  # different season, no team
    assert result is None


async def test_no_current_week_cached_returns_matchup_null(pool):
    owner_id, _ = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        result = await build_your_week(conn, owner_id, season=TEST_SEASON)
    assert result["team_name"] == "Team Alpha"
    assert result["matchup"] is None


async def test_draft_is_none_when_no_draft_config_exists(pool):
    owner_id, _ = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        result = await build_your_week(conn, owner_id, season=TEST_SEASON)
    assert result["draft"] is None


async def test_draft_reflects_scheduled_start_and_status(pool):
    from datetime import datetime, timezone

    owner_id, _ = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO draft_config (season, draft_order, roster_slots, scheduled_start) "
            "VALUES ($1, '{}', '{}', $2)",
            TEST_SEASON, datetime(2026, 9, 5, 20, 0, tzinfo=timezone.utc),
        )
        result = await build_your_week(conn, owner_id, season=TEST_SEASON)
        await conn.execute("DELETE FROM draft_config WHERE season = $1", TEST_SEASON)
    assert result["draft"]["status"] == "not_started"
    assert result["draft"]["scheduled_start"] is not None


async def test_bye_week_returns_matchup_null(pool):
    owner_id, team_id = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 3) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        result = await build_your_week(conn, owner_id, season=TEST_SEASON)
        await conn.execute("DELETE FROM league_state WHERE season = $1", TEST_SEASON)
    assert result["week"] == 3
    assert result["matchup"] is None


async def test_in_progress_matchup_computes_win_probability(pool):
    owner_id, team_id = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        opp_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ('test-yourweek-opp', 'Bob') RETURNING owner_id"
        )
        opp_team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, 2, $2, 'Team Beta') RETURNING id",
            TEST_SEASON, opp_id,
        )
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 1) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $3, 55.5, 40.0, FALSE)",
            TEST_SEASON, team_id, opp_team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'My Starter', 'RB', 'RB', 30.0, 90.0)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Opp Starter', 'RB', 'RB', 20.0, 40.0)",
            TEST_SEASON, opp_team_id,
        )

        result = await build_your_week(conn, owner_id, season=TEST_SEASON)

        await conn.execute("DELETE FROM rosters WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM matchups WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM league_state WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM teams_by_season WHERE id = $1", opp_team_id)
        await conn.execute("DELETE FROM owners WHERE owner_id = $1", opp_id)

    m = result["matchup"]
    assert m["started"] is True
    assert m["my_score"] == 55.5
    assert m["opponent_score"] == 40.0
    assert m["opponent_team_name"] == "Team Beta"
    assert m["win_probability"] is not None
    assert m["win_probability"] > 50  # ahead on score and projection


async def test_week_endpoint_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/me/week")
    assert resp.status_code == 401


async def test_week_endpoint_returns_your_week(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, _ = await _seed_owner_and_team(pool)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/week")
    assert resp.status_code == 200
    assert resp.json()["team_name"] == "Team Alpha"


async def test_week_endpoint_404_when_no_team_in_active_season(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON + 5))  # owner has no team here
    owner_id, _ = await _seed_owner_and_team(pool)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/week")
    assert resp.status_code == 404
