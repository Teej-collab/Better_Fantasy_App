from app.domain import matchup_scoring
from tests.conftest import TEST_SEASON


async def _seed_team(pool, suffix, espn_team_id, owner_suffix=None):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-matchupscoring-owner-{owner_suffix or suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return team_id


async def _seed_player(pool, sleeper_id, position="WR"):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE)
            """,
            sleeper_id, f"Test Player {sleeper_id}", position, [position],
        )


async def _seed_roster_and_stats(pool, team_id, sleeper_id, lineup_slot, points, week=1):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, $4, 'draft')",
            TEST_SEASON, team_id, sleeper_id, lineup_slot,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, $2, $3, '{}', $4)",
            TEST_SEASON, week, sleeper_id, points,
        )


async def test_compute_team_score_sums_starters_only(pool):
    team_id = await _seed_team(pool, "s1", 601)
    await _seed_player(pool, "test-ms-starter1")
    await _seed_player(pool, "test-ms-starter2")
    await _seed_player(pool, "test-ms-bench1")
    await _seed_player(pool, "test-ms-ir1")
    await _seed_roster_and_stats(pool, team_id, "test-ms-starter1", "WR", 12.5)
    await _seed_roster_and_stats(pool, team_id, "test-ms-starter2", "RB", 8.0)
    await _seed_roster_and_stats(pool, team_id, "test-ms-bench1", "BE", 30.0)  # excluded
    await _seed_roster_and_stats(pool, team_id, "test-ms-ir1", "IR", 99.0)  # excluded

    async with pool.acquire() as conn:
        score = await matchup_scoring.compute_team_score(conn, TEST_SEASON, 1, team_id)

    assert score == 20.5


async def test_compute_matchup_scores_for_week_updates_both_teams(pool):
    home_id = await _seed_team(pool, "home", 602)
    away_id = await _seed_team(pool, "away", 603)
    await _seed_player(pool, "test-ms-home1")
    await _seed_player(pool, "test-ms-away1")
    await _seed_roster_and_stats(pool, home_id, "test-ms-home1", "WR", 15.0)
    await _seed_roster_and_stats(pool, away_id, "test-ms-away1", "WR", 22.25)

    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 1, home_id, away_id,
        )
        updated = await matchup_scoring.compute_matchup_scores_for_week(conn, TEST_SEASON, 1)
        row = await conn.fetchrow("SELECT home_score, away_score FROM matchups WHERE id = $1", matchup_id)

    assert updated == 1
    assert float(row["home_score"]) == 15.0
    assert float(row["away_score"]) == 22.25


async def test_compute_matchup_scores_for_week_is_a_noop_with_no_matchups(pool):
    async with pool.acquire() as conn:
        updated = await matchup_scoring.compute_matchup_scores_for_week(conn, TEST_SEASON, 1)
    assert updated == 0


async def test_compute_team_score_is_zero_with_no_stats_yet(pool):
    team_id = await _seed_team(pool, "s2", 604)
    await _seed_player(pool, "test-ms-nostats")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'WR', 'draft')",
            TEST_SEASON, team_id, "test-ms-nostats",
        )
        # No player_week_stats row seeded — the JOIN should just exclude this player.
        score = await matchup_scoring.compute_team_score(conn, TEST_SEASON, 1, team_id)
    assert score == 0.0


async def test_compute_team_score_uses_that_weeks_frozen_lineup_not_todays_roster(pool):
    # Real bug, confirmed against production data (2026-09-22): a team
    # swapped a starter for week 2 (e.g. D/ST and a WR), and re-scoring
    # week 1 afterward — compute_team_score used to join current_rosters
    # straight, so it silently recomputed week 1's already-decided score
    # using the NEW (week 2) starters instead of who actually played
    # week 1, flipping a real win into a loss in the standings. Week 1
    # is no longer the "current" week (league_state says week 2), so
    # get_roster_for_week must use roster_history's real week-1 snapshot.
    team_id = await _seed_team(pool, "frozen", 605)
    await _seed_player(pool, "test-ms-week1-starter")
    await _seed_player(pool, "test-ms-week2-starter")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        # Week 1's real, frozen lineup (what actually played).
        await conn.execute(
            "INSERT INTO roster_history (season, week, team_id, sleeper_player_id, lineup_slot) "
            "VALUES ($1, 1, $2, $3, 'WR')",
            TEST_SEASON, team_id, "test-ms-week1-starter",
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, $2, '{}', 25.0), ($1, 1, $3, '{}', 999.0)",
            TEST_SEASON, "test-ms-week1-starter", "test-ms-week2-starter",
        )
        # Today's live roster reflects the week-2 swap — a different starter.
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'WR', 'draft')",
            TEST_SEASON, team_id, "test-ms-week2-starter",
        )

        score = await matchup_scoring.compute_team_score(conn, TEST_SEASON, 1, team_id)
        await pool.execute("DELETE FROM league_state WHERE season = $1", TEST_SEASON)

    assert score == 25.0  # week 1's real starter's score, not the swapped-in player's 999.0
