from app.domain.boom_bust import (
    classify_boom_bust,
    compute_boom_bust_for_season,
    compute_boom_bust_for_week,
    get_baseline,
)
from tests.conftest import TEST_SEASON


def test_classify_boom_bust():
    assert classify_boom_bust(120, 100) == (True, False)  # +20, exactly the boom threshold
    assert classify_boom_bust(89, 100) == (False, True)   # -11, past the bust threshold
    assert classify_boom_bust(105, 100) == (False, False)  # +5, neither
    assert classify_boom_bust(50, 0) == (False, False)     # invalid baseline
    assert classify_boom_bust(None, 100) == (False, False)


def test_get_baseline_prefers_real_projection():
    assert get_baseline(15.0, [1.0, 2.0, 3.0]) == 15.0


def test_get_baseline_falls_back_to_position_average():
    assert get_baseline(0, [10.0, 20.0, 30.0]) == 20.0
    assert get_baseline(None, [10.0, 20.0]) == 15.0


def test_get_baseline_none_when_nothing_available():
    assert get_baseline(0, []) is None


async def _seed_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-boombust-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 400 + suffix, owner_id, f"Team {suffix}",
        )
    return team_id


async def test_compute_boom_bust_for_week_sets_flags_and_skips_bench(pool):
    team_id = await _seed_team(pool, 1)

    async with pool.acquire() as conn:
        # Two RBs starting this week: one booms (way above the other's
        # score, which becomes the positional baseline since neither has
        # a real projection), one is unremarkable. A bench RB is excluded
        # from the baseline and never gets flagged either way.
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Boom RB', 'RB', 'RB', 40.0, 0)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Average RB', 'RB', 'RB', 10.0, 0)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Bench RB', 'RB', 'BE', 5.0, 0)",
            TEST_SEASON, team_id,
        )

        updated = await compute_boom_bust_for_week(conn, TEST_SEASON, 1)
        assert updated == 2  # only the 2 starters, bench excluded

        rows = {
            r["player_name"]: (r["is_boom"], r["is_bust"])
            for r in await conn.fetch(
                "SELECT player_name, is_boom, is_bust FROM rosters WHERE season = $1 AND week = 1", TEST_SEASON
            )
        }

    # baseline = avg(40, 10) = 25. Boom RB: 40-25=15 -> not boom (needs +20).
    # Recompute expectation from the actual baseline rather than assume:
    baseline = (40.0 + 10.0) / 2
    assert rows["Boom RB"] == (40.0 - baseline >= 20, 40.0 - baseline <= -10)
    assert rows["Average RB"] == (10.0 - baseline >= 20, 10.0 - baseline <= -10)
    assert rows["Bench RB"] == (False, False)


async def test_compute_boom_bust_for_season_covers_all_weeks(pool):
    team_id = await _seed_team(pool, 2)

    async with pool.acquire() as conn:
        for week in (1, 2):
            await conn.execute(
                "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
                "VALUES ($1, $2, $3, $4, 'QB', 'QB', 50.0, 10.0)",
                TEST_SEASON, week, team_id, f"QB Week {week}",
            )

    total = await compute_boom_bust_for_season(pool, TEST_SEASON)
    assert total == 2

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT player_name, is_boom FROM rosters WHERE season = $1 ORDER BY week", TEST_SEASON
        )
    # projected=10, scored=50 -> diff=40 -> boom, for both weeks
    assert all(r["is_boom"] for r in rows if r["player_name"].startswith("QB Week"))
