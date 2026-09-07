from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.domain.your_week import build_your_week
from app.main import app
from tests.conftest import TEST_SEASON, make_safe_session_user_id

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id(pool), owner_id=owner_id, discord_user_id=999, is_commissioner=False
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


async def test_draft_falls_back_to_a_pre_set_schedule_with_no_draft_config(pool):
    """A commissioner can set just the draft date before deciding the
    order (PUT /draft/schedule, held in league_draft_schedule until a
    real draft exists) — the homepage's Draft Countdown card should
    still work in that case, not just once draft_config exists."""
    from datetime import datetime, timezone

    owner_id, _ = await _seed_owner_and_team(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_draft_schedule (season, league_id, scheduled_start) VALUES ($1, 1, $2)",
            TEST_SEASON, datetime(2026, 9, 5, 20, 0, tzinfo=timezone.utc),
        )
        result = await build_your_week(conn, owner_id, season=TEST_SEASON)
        await conn.execute("DELETE FROM league_draft_schedule WHERE season = $1", TEST_SEASON)
    assert result["draft"]["status"] == "not_started"
    assert result["draft"]["scheduled_start"] is not None


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
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-yw-my-starter', 'My Starter', 'RB', 'KC', TRUE, 90.0)"
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-yw-opp-starter', 'Opp Starter', 'RB', 'SF', TRUE, 40.0)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-yw-my-starter', 'RB', 'draft')",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-yw-opp-starter', 'RB', 'draft')",
            TEST_SEASON, opp_team_id,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, 'test-yw-my-starter', '{}', 30.0)",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, 'test-yw-opp-starter', '{}', 20.0)",
            TEST_SEASON,
        )

        result = await build_your_week(conn, owner_id, season=TEST_SEASON)

        await conn.execute("DELETE FROM player_week_stats WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM current_rosters WHERE season = $1", TEST_SEASON)
        await conn.execute(
            "DELETE FROM players WHERE sleeper_player_id IN ('test-yw-my-starter', 'test-yw-opp-starter')"
        )
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/week")
    assert resp.status_code == 200
    assert resp.json()["team_name"] == "Team Alpha"


async def test_week_endpoint_404_when_no_team_in_active_season(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON + 5))  # owner has no team here
    owner_id, _ = await _seed_owner_and_team(pool)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/week")
    assert resp.status_code == 404
