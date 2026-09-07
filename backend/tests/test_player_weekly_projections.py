from app.domain.weekly_team_stats import compute_team_projected_for_week
from app.queries.league import get_current_roster
from app.queries.roster_history import snapshot_week
from tests.conftest import TEST_SEASON


async def _seed_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-weeklyproj-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 800 + suffix, owner_id, f"Team {suffix}",
        )
    return team_id


async def _add_player(conn, sleeper_id, name, team_id, slot, avg_projected=10.0):
    await conn.execute(
        "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_avg_points) "
        "VALUES ($1, $2, 'RB', TRUE, $3)",
        sleeper_id, name, avg_projected,
    )
    await conn.execute(
        "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
        "VALUES ($1, $2, $3, $4, 'draft')",
        TEST_SEASON, team_id, sleeper_id, slot,
    )


async def test_get_current_roster_prefers_real_weekly_projection(pool):
    team_id = await _seed_team(pool, 1)
    async with pool.acquire() as conn:
        await _add_player(conn, "test-wp-p1", "Player One", team_id, "RB", avg_projected=10.0)
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
            "VALUES ($1, 1, 'test-wp-p1', 18.5)",
            TEST_SEASON,
        )
        roster = await get_current_roster(conn, TEST_SEASON, team_id, 1)
        assert float(roster[0]["points_projected"]) == 18.5


async def test_get_current_roster_falls_back_to_season_average_without_weekly_row(pool):
    team_id = await _seed_team(pool, 2)
    async with pool.acquire() as conn:
        await _add_player(conn, "test-wp-p2", "Player Two", team_id, "RB", avg_projected=12.3)
        roster = await get_current_roster(conn, TEST_SEASON, team_id, 1)
        assert float(roster[0]["points_projected"]) == 12.3


async def test_snapshot_week_freezes_real_weekly_projection_when_available(pool):
    team_id = await _seed_team(pool, 3)
    async with pool.acquire() as conn:
        await _add_player(conn, "test-wp-p3", "Player Three", team_id, "RB", avg_projected=10.0)
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
            "VALUES ($1, 1, 'test-wp-p3', 21.0)",
            TEST_SEASON,
        )
        await snapshot_week(conn, TEST_SEASON, 1)
        row = await conn.fetchrow(
            "SELECT points_projected FROM roster_history WHERE season = $1 AND week = 1 AND sleeper_player_id = 'test-wp-p3'",
            TEST_SEASON,
        )
        assert float(row["points_projected"]) == 21.0


async def test_snapshot_week_falls_back_to_season_average_without_weekly_row(pool):
    team_id = await _seed_team(pool, 4)
    async with pool.acquire() as conn:
        await _add_player(conn, "test-wp-p4", "Player Four", team_id, "RB", avg_projected=9.5)
        await snapshot_week(conn, TEST_SEASON, 1)
        row = await conn.fetchrow(
            "SELECT points_projected FROM roster_history WHERE season = $1 AND week = 1 AND sleeper_player_id = 'test-wp-p4'",
            TEST_SEASON,
        )
        assert float(row["points_projected"]) == 9.5


async def test_compute_team_projected_for_week_varies_by_week(pool):
    """Regression test for the bug this session fixed: the same player's
    real per-week projection differing across weeks must produce a
    different team total per week, not the same season-average number
    every time."""
    team_id = await _seed_team(pool, 5)
    async with pool.acquire() as conn:
        await _add_player(conn, "test-wp-p5", "Player Five", team_id, "RB", avg_projected=10.0)
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
            "VALUES ($1, 1, 'test-wp-p5', 15.0), ($1, 2, 'test-wp-p5', 22.0)",
            TEST_SEASON,
        )
        await compute_team_projected_for_week(conn, TEST_SEASON, 1)
        await compute_team_projected_for_week(conn, TEST_SEASON, 2)
        week1 = await conn.fetchval(
            "SELECT team_points_projected FROM weekly_team_stats WHERE season = $1 AND week = 1 AND team_id = $2",
            TEST_SEASON, team_id,
        )
        week2 = await conn.fetchval(
            "SELECT team_points_projected FROM weekly_team_stats WHERE season = $1 AND week = 2 AND team_id = $2",
            TEST_SEASON, team_id,
        )
        assert float(week1) == 15.0
        assert float(week2) == 22.0
        assert week1 != week2


async def test_compute_team_projected_for_week_mixed_coverage_falls_back_per_player(pool):
    """Regression test for the real ~83% coverage case: one starter has
    a real weekly projection, another doesn't — the team total must sum
    the real number for the covered player and the season-average for
    the uncovered one, not degrade to zero or the whole team's average."""
    team_id = await _seed_team(pool, 6)
    async with pool.acquire() as conn:
        await _add_player(conn, "test-wp-p6a", "Covered Player", team_id, "RB", avg_projected=10.0)
        await _add_player(conn, "test-wp-p6b", "Uncovered Player", team_id, "WR", avg_projected=8.0)
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
            "VALUES ($1, 1, 'test-wp-p6a', 17.0)",
            TEST_SEASON,
        )
        await compute_team_projected_for_week(conn, TEST_SEASON, 1)
        total = await conn.fetchval(
            "SELECT team_points_projected FROM weekly_team_stats WHERE season = $1 AND week = 1 AND team_id = $2",
            TEST_SEASON, team_id,
        )
        assert float(total) == 17.0 + 8.0
