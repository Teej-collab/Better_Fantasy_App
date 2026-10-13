from app.config import DEFAULT_LEAGUE_ID
from app.domain.bench_crimes import (
    classify_severity,
    compute_bench_crimes_for_season,
    compute_bench_crimes_for_week,
    detect_bench_crimes,
)
from tests.conftest import TEST_SEASON


def test_classify_severity_thresholds():
    assert classify_severity(30) == "Felony Bench Crime"
    assert classify_severity(20) == "High Misdemeanor"
    assert classify_severity(10) == "Low Misdemeanor"
    assert classify_severity(9.9) == "Minor Infraction"


def test_detect_bench_crimes_matches_true_position_not_slot():
    rows = [
        # Started at FLEX, but true position is RB.
        {"player_name": "Starter", "position": "RB", "lineup_slot": "RB/WR/TE", "points_scored": 10},
        {"player_name": "Bench RB", "position": "RB", "lineup_slot": "BE", "points_scored": 25},
        # Different position -> never compared against the RB starter.
        {"player_name": "Bench WR", "position": "WR", "lineup_slot": "BE", "points_scored": 15},
    ]
    crimes = detect_bench_crimes(rows)
    assert len(crimes) == 1
    assert crimes[0]["bench_player"] == "Bench RB"
    assert crimes[0]["started_player"] == "Starter"
    assert crimes[0]["points_diff"] == 15
    assert crimes[0]["severity"] == "Low Misdemeanor"


def test_detect_bench_crimes_one_bench_player_can_commit_multiple_crimes():
    rows = [
        {"player_name": "Starter A", "position": "WR", "lineup_slot": "WR", "points_scored": 5},
        {"player_name": "Starter B", "position": "WR", "lineup_slot": "WR", "points_scored": 8},
        {"player_name": "Bench WR", "position": "WR", "lineup_slot": "BE", "points_scored": 20},
    ]
    crimes = detect_bench_crimes(rows)
    assert len(crimes) == 2
    assert {c["started_player"] for c in crimes} == {"Starter A", "Starter B"}


def test_detect_bench_crimes_none_when_bench_underperforms():
    rows = [
        {"player_name": "Starter", "position": "TE", "lineup_slot": "TE", "points_scored": 12},
        {"player_name": "Bench TE", "position": "TE", "lineup_slot": "BE", "points_scored": 3},
    ]
    assert detect_bench_crimes(rows) == []


async def _seed_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-benchcrime-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 700 + suffix, owner_id, f"Team {suffix}",
        )
    return team_id


async def test_compute_bench_crimes_for_week_writes_rows(pool):
    team_id = await _seed_team(pool, 1)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Starter RB', 'RB', 'RB', 5, 10)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Bench RB', 'RB', 'BE', 40, 10)",
            TEST_SEASON, team_id,
        )

        crime_count = await compute_bench_crimes_for_week(conn, TEST_SEASON, 1)
        assert crime_count == 1

        rows = await conn.fetch(
            "SELECT bench_player, started_player, severity FROM bench_crimes WHERE season = $1 AND week = 1 AND team_id = $2",
            TEST_SEASON, team_id,
        )
    assert len(rows) == 1
    assert rows[0]["bench_player"] == "Bench RB"
    assert rows[0]["severity"] == "Felony Bench Crime"  # diff = 35


async def test_compute_bench_crimes_for_week_rerun_replaces_not_duplicates(pool):
    team_id = await _seed_team(pool, 2)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Starter RB', 'RB', 'RB', 5, 10)",
            TEST_SEASON, team_id,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
            "VALUES ($1, 1, $2, 'Bench RB', 'RB', 'BE', 40, 10)",
            TEST_SEASON, team_id,
        )
        await compute_bench_crimes_for_week(conn, TEST_SEASON, 1)

        # A late stat correction fixes the starter's score above the
        # bench player's -> the crime should disappear, not accumulate.
        await conn.execute(
            "UPDATE rosters SET points_scored = 45 WHERE season = $1 AND week = 1 AND team_id = $2 AND player_name = 'Starter RB'",
            TEST_SEASON, team_id,
        )
        await compute_bench_crimes_for_week(conn, TEST_SEASON, 1)

        rows = await conn.fetch(
            "SELECT * FROM bench_crimes WHERE season = $1 AND week = 1 AND team_id = $2", TEST_SEASON, team_id
        )
    assert rows == []


async def test_compute_bench_crimes_for_season_covers_all_weeks(pool):
    team_id = await _seed_team(pool, 3)

    async with pool.acquire() as conn:
        for week in (1, 2):
            await conn.execute(
                "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
                "VALUES ($1, $2, $3, 'Starter RB', 'RB', 'RB', 5, 10)",
                TEST_SEASON, week, team_id,
            )
            await conn.execute(
                "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected) "
                "VALUES ($1, $2, $3, 'Bench RB', 'RB', 'BE', 40, 10)",
                TEST_SEASON, week, team_id,
            )

    total = await compute_bench_crimes_for_season(pool, TEST_SEASON)
    assert total == 2


async def test_in_app_bench_crimes_only_read_this_leagues_teams(pool):
    """2026-10-13: roster_history has no league column, and every
    league's lineups were read — Week 5's "biggest bench crime" in League
    #1 was a sandbox team benching Bucky Irving."""
    async with pool.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", TEST_SEASON):
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, '{}')", TEST_SEASON, []
            )
        creator = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES "
            "('test-benchcrime-other-league@example.com', 'x', 'Other') RETURNING id"
        )
        other_league = await conn.fetchval(
            "INSERT INTO leagues (name, created_by_user_id, invite_code) VALUES "
            "('Test League Bench Crimes', $1, 'BENCH-CRIMES') RETURNING id",
            creator,
        )
    mine = await _seed_team(pool, 41)
    theirs = await _seed_team(pool, 42)
    async with pool.acquire() as conn:
        await conn.execute("UPDATE teams_by_season SET league_id = $1 WHERE id = $2", other_league, theirs)
        for suffix in ("start", "bench"):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
                "VALUES ($1, $2, 'RB', '{RB}', 'KC', 'Active', TRUE)",
                f"test-benchcrime-{suffix}", f"Bench Test {suffix}",
            )
            await conn.execute(
                "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, league_id) "
                "VALUES ($1, 1, $2, '{}', $3, $4)",
                TEST_SEASON, f"test-benchcrime-{suffix}", 5.0 if suffix == "start" else 25.0, DEFAULT_LEAGUE_ID,
            )
        for team_id in (mine, theirs):
            await conn.execute(
                "INSERT INTO roster_history (season, week, team_id, sleeper_player_id, lineup_slot) VALUES "
                "($1, 1, $2, 'test-benchcrime-start', 'RB'), ($1, 1, $2, 'test-benchcrime-bench', 'BE')",
                TEST_SEASON, team_id,
            )

        await compute_bench_crimes_for_week(conn, TEST_SEASON, 1, DEFAULT_LEAGUE_ID)
        teams = {r["team_id"] for r in await conn.fetch(
            "SELECT team_id FROM bench_crimes WHERE season = $1 AND week = 1 AND league_id = $2",
            TEST_SEASON, DEFAULT_LEAGUE_ID,
        )}
        await conn.execute("UPDATE teams_by_season SET league_id = $1 WHERE id = $2", DEFAULT_LEAGUE_ID, theirs)
    assert teams == {mine}
