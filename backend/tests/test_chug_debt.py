from app.domain.chug_debt import (
    compute_chug_debts_for_season,
    compute_chug_debts_for_week,
    compute_chugs_owed,
)
from tests.conftest import TEST_SEASON


def test_compute_chugs_owed_counts_active_zero_or_negative_scores():
    rows = [
        {"lineup_slot": "QB", "points_scored": 0},       # owed: active, 0 points
        {"lineup_slot": "RB", "points_scored": -2},      # owed: active, negative
        {"lineup_slot": "WR", "points_scored": 15},      # not owed: active, scored
        {"lineup_slot": "BE", "points_scored": 0},       # not owed: bench, regardless of score
        {"lineup_slot": "IR", "points_scored": 0},       # not owed: IR, regardless of score
    ]
    assert compute_chugs_owed(rows) == 2


def test_compute_chugs_owed_treats_null_points_as_zero():
    rows = [{"lineup_slot": "TE", "points_scored": None}]
    assert compute_chugs_owed(rows) == 1


async def _seed_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-chugdebt-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 500 + suffix, owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def test_compute_chug_debts_for_week_writes_per_owner(pool):
    owner_id, team_id = await _seed_team(pool, 1)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Dud QB', 'QB', 'QB', 0, 15)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Good RB', 'RB', 'RB', 22, 15)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Bench Dud', 'WR', 'BE', 0, 10)",
            TEST_SEASON, team_id,
        )

        updated = await compute_chug_debts_for_week(conn, TEST_SEASON, 1)
        assert updated == 1  # one distinct team this week

        row = await conn.fetchrow(
            "SELECT chugs_owed FROM chug_debts WHERE season = $1 AND week = 1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )
    assert row["chugs_owed"] == 1  # only the starting QB, bench excluded


async def test_compute_chug_debts_for_week_upserts_on_rerun(pool):
    owner_id, team_id = await _seed_team(pool, 2)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Dud QB', 'QB', 'QB', 0, 15)",
            TEST_SEASON, team_id,
        )
        await compute_chug_debts_for_week(conn, TEST_SEASON, 1)

        # Re-sync corrects the score upward (e.g. a late stat correction) —
        # rerunning should update the existing row, not duplicate it.
        await conn.execute(
            "UPDATE rosters SET points_scored = 12 WHERE season = $1 AND week = 1 AND team_id = $2",
            TEST_SEASON, team_id,
        )
        await compute_chug_debts_for_week(conn, TEST_SEASON, 1)

        rows = await conn.fetch(
            "SELECT chugs_owed FROM chug_debts WHERE season = $1 AND week = 1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )
    assert len(rows) == 1
    assert rows[0]["chugs_owed"] == 0


async def test_compute_chug_debts_for_season_covers_all_weeks(pool):
    owner_id, team_id = await _seed_team(pool, 3)

    async with pool.acquire() as conn:
        for week in (1, 2):
            await conn.execute(
                "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
                "VALUES ($1, $2, $3, 'Dud QB', 'QB', 'QB', 0, 15)",
                TEST_SEASON, week, team_id,
            )

    await compute_chug_debts_for_season(pool, TEST_SEASON)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT week, chugs_owed FROM chug_debts WHERE season = $1 AND owner_id = $2 ORDER BY week",
            TEST_SEASON, owner_id,
        )
    assert [(r["week"], r["chugs_owed"]) for r in rows] == [(1, 1), (2, 1)]
