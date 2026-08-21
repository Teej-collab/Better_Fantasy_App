from app.domain.weekly_team_stats import (
    compute_chaos_score,
    compute_luck_score,
    compute_power_ranks,
    compute_weekly_team_stats_for_season,
    compute_weekly_team_stats_for_week,
)
from tests.conftest import TEST_SEASON


def test_compute_luck_score_lucky_win():
    # team scored below the median but still won -> positive (lucky)
    assert compute_luck_score(50, [50, 60, 70, 40], won=True) > 0


def test_compute_luck_score_unlucky_loss():
    # team scored above the median but still lost -> negative (unlucky)
    assert compute_luck_score(70, [70, 60, 50, 40], won=False) < 0


def test_compute_luck_score_result_matched_score():
    assert compute_luck_score(70, [70, 60, 50, 40], won=True) == 0.0
    assert compute_luck_score(40, [70, 60, 50, 40], won=False) == 0.0


def test_compute_luck_score_no_other_teams():
    assert compute_luck_score(50, [50], won=True) == 0.0


def test_compute_chaos_score_scales_with_swung_starters():
    assert compute_chaos_score(boom_count=2, bust_count=1, total_starters=9) == round(3 / 9 * 100, 2)
    assert compute_chaos_score(0, 0, 9) == 0.0
    assert compute_chaos_score(0, 0, 0) == 0.0


def test_compute_power_ranks_orders_best_first():
    stats = [
        {"team_id": 1, "win_pct": 1.0, "avg_points": 120.0, "recent_form": 130.0},
        {"team_id": 2, "win_pct": 0.0, "avg_points": 80.0, "recent_form": 70.0},
    ]
    ranks = compute_power_ranks(stats)
    assert ranks[1] == 1
    assert ranks[2] == 2


async def _seed_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-wts-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 600 + suffix, owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def test_compute_weekly_team_stats_for_week_fills_all_columns(pool):
    _, team_a = await _seed_team(pool, 1)
    _, team_b = await _seed_team(pool, 2)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 120, 90)",
            TEST_SEASON, team_a, team_b,
        )
        for team_id, name in ((team_a, "A"), (team_b, "B")):
            await conn.execute(
                "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, "
                "points_scored, points_projected) VALUES ($1, 1, $2, $3, 'QB', 'QB', 30, 20)",
                TEST_SEASON, team_id, f"QB {name}",
            )

        await compute_weekly_team_stats_for_week(conn, TEST_SEASON, 1)

        rows = {
            r["team_id"]: r
            for r in await conn.fetch(
                "SELECT team_id, power_rank, luck_score, chaos_score, team_points_projected "
                "FROM weekly_team_stats WHERE season = $1 AND week = 1",
                TEST_SEASON,
            )
        }

    assert rows[team_a]["power_rank"] == 1  # won, higher score
    assert rows[team_b]["power_rank"] == 2
    assert rows[team_a]["team_points_projected"] == 20
    assert rows[team_b]["team_points_projected"] == 20
    # Both teams' single result matched their relative score (winner
    # outscored, loser was outscored) -> no luck involved either way.
    assert float(rows[team_a]["luck_score"]) == 0.0
    assert float(rows[team_b]["luck_score"]) == 0.0


async def test_compute_weekly_team_stats_for_season_covers_all_weeks(pool):
    _, team_a = await _seed_team(pool, 3)
    _, team_b = await _seed_team(pool, 4)

    async with pool.acquire() as conn:
        for week in (1, 2):
            await conn.execute(
                "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
                "VALUES ($1, $2, $3, $4, 100, 80)",
                TEST_SEASON, week, team_a, team_b,
            )

    await compute_weekly_team_stats_for_season(pool, TEST_SEASON)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT week, power_rank FROM weekly_team_stats WHERE season = $1 AND team_id = $2 ORDER BY week",
            TEST_SEASON, team_a,
        )
    assert [r["week"] for r in rows] == [1, 2]
    assert all(r["power_rank"] == 1 for r in rows)


async def test_compute_weekly_team_stats_skips_unplayed_weeks(pool):
    _, team_a = await _seed_team(pool, 5)
    _, team_b = await _seed_team(pool, 6)

    async with pool.acquire() as conn:
        # Scheduled but not played yet -> ESPN's 0/0 placeholder.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 0, 0)",
            TEST_SEASON, team_a, team_b,
        )

    total = await compute_weekly_team_stats_for_season(pool, TEST_SEASON)
    assert total == 0
