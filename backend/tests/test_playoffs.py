from app.config import DEFAULT_LEAGUE_ID
from app.domain import playoffs
from app.domain.playoff_exceptions import (
    PlayoffAlreadyGeneratedError,
    PlayoffTeamCountUnknownError,
    RegularSeasonNotStartedError,
    UnsupportedPlayoffTeamCountError,
)
from tests.conftest import TEST_SEASON


async def _seed_team(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-playoffs-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return team_id


async def _seed_regular_season_matchup(pool, week, home_team_id, away_team_id, home_score, away_score):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            TEST_SEASON, week, home_team_id, away_team_id, home_score, away_score,
        )


async def _set_playoff_settings(pool, playoff_team_count, weeks_per_matchup=1, start_week=None):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_playoff_settings (season, league_id, playoff_team_count, weeks_per_matchup, start_week) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, DEFAULT_LEAGUE_ID, playoff_team_count, weeks_per_matchup, start_week,
        )


async def _four_team_bracket_fixture(pool):
    """4 teams with a clean, deterministic regular-season ranking:
    team_1 (2-0, best), team_2 (1-1 but more points), team_3 (1-1,
    fewer points), team_4 (0-2, worst) — seeds 1-4 in that order."""
    team_1 = await _seed_team(pool, "one", 301)
    team_2 = await _seed_team(pool, "two", 302)
    team_3 = await _seed_team(pool, "three", 303)
    team_4 = await _seed_team(pool, "four", 304)
    await _seed_regular_season_matchup(pool, 1, team_1, team_4, 120, 80)
    await _seed_regular_season_matchup(pool, 1, team_2, team_3, 110, 90)
    await _seed_regular_season_matchup(pool, 2, team_1, team_3, 115, 95)
    await _seed_regular_season_matchup(pool, 2, team_4, team_2, 85, 105)
    return team_1, team_2, team_3, team_4


async def test_generate_playoff_bracket_seeds_round_1_from_standings(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=2)

    async with pool.acquire() as conn:
        nodes = await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    round_1 = sorted((n for n in nodes if n["round"] == 1), key=lambda n: n["slot"])
    assert len(round_1) == 2
    assert round_1[0]["team_a_id"] == team_1 and round_1[0]["team_a_seed"] == 1
    assert round_1[0]["team_b_id"] == team_4 and round_1[0]["team_b_seed"] == 4
    assert round_1[1]["team_a_id"] == team_2 and round_1[1]["team_a_seed"] == 2
    assert round_1[1]["team_b_id"] == team_3 and round_1[1]["team_b_seed"] == 3

    round_2 = [n for n in nodes if n["round"] == 2]
    assert len(round_2) == 1
    assert round_2[0]["team_a_id"] is None and round_2[0]["team_b_id"] is None


async def test_generate_playoff_bracket_creates_real_matchup_weeks_for_round_1(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=2)

    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        rows = await conn.fetch(
            "SELECT week, home_team_id, away_team_id, is_playoff, playoff_bracket_matchup_id FROM matchups "
            "WHERE season = $1 AND is_playoff = TRUE ORDER BY week, home_team_id",
            TEST_SEASON,
        )

    weeks = sorted({r["week"] for r in rows})
    assert weeks == [3, 4]  # last regular-season week was 2 -> playoffs start at 3
    assert len(rows) == 4  # 2 round-1 pairings x 2 weeks each
    assert all(r["is_playoff"] for r in rows)
    assert all(r["playoff_bracket_matchup_id"] is not None for r in rows)


async def test_generate_playoff_bracket_honors_explicit_start_week(pool):
    await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=1, start_week=15)

    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        weeks = await conn.fetch(
            "SELECT DISTINCT week FROM matchups WHERE season = $1 AND is_playoff = TRUE", TEST_SEASON
        )
    assert {r["week"] for r in weeks} == {15}


async def test_generate_playoff_bracket_rejects_double_generation(pool):
    await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4)

    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        try:
            await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
            assert False, "expected PlayoffAlreadyGeneratedError"
        except PlayoffAlreadyGeneratedError:
            pass


async def test_generate_playoff_bracket_rejects_non_power_of_two(pool):
    await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=3)

    async with pool.acquire() as conn:
        try:
            await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
            assert False, "expected UnsupportedPlayoffTeamCountError"
        except UnsupportedPlayoffTeamCountError:
            pass


async def test_generate_playoff_bracket_rejects_unknown_team_count(pool):
    await _four_team_bracket_fixture(pool)

    async with pool.acquire() as conn:
        try:
            await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
            assert False, "expected PlayoffTeamCountUnknownError"
        except PlayoffTeamCountUnknownError:
            pass


async def test_generate_playoff_bracket_rejects_no_regular_season(pool):
    await _seed_team(pool, "lonely", 399)
    await _set_playoff_settings(pool, playoff_team_count=2)

    async with pool.acquire() as conn:
        try:
            await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
            assert False, "expected RegularSeasonNotStartedError"
        except RegularSeasonNotStartedError:
            pass


async def _score_playoff_week(pool, week, home_team_id, away_team_id, home_score, away_score):
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE matchups SET home_score = $1, away_score = $2 "
            "WHERE season = $3 AND week = $4 AND home_team_id = $5 AND away_team_id = $6",
            home_score, away_score, TEST_SEASON, week, home_team_id, away_team_id,
        )


async def test_resolve_ready_playoff_matchups_waits_for_all_weeks_scored(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=2)
    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    await _score_playoff_week(pool, 3, team_1, team_4, 100, 90)  # only week 3 of 2 scored so far

    async with pool.acquire() as conn:
        resolved = await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
    assert resolved == []


async def test_resolve_ready_playoff_matchups_resolves_on_aggregate_score(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=2)
    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    # team_1 (home both weeks) beats team_4 in aggregate: 100+100=200 vs 90+80=170.
    await _score_playoff_week(pool, 3, team_1, team_4, 100, 90)
    await _score_playoff_week(pool, 4, team_1, team_4, 100, 80)

    async with pool.acquire() as conn:
        resolved = await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        winner = await conn.fetchval(
            "SELECT winner_team_id FROM playoff_bracket_matchups WHERE season = $1 AND round = 1 AND slot = 0",
            TEST_SEASON,
        )
    assert len(resolved) == 1
    assert winner == team_1


async def test_resolve_ready_playoff_matchups_tie_goes_to_better_seed(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=1)
    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    await _score_playoff_week(pool, 3, team_1, team_4, 100, 100)  # exact tie

    async with pool.acquire() as conn:
        await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        winner = await conn.fetchval(
            "SELECT winner_team_id FROM playoff_bracket_matchups WHERE season = $1 AND round = 1 AND slot = 0",
            TEST_SEASON,
        )
    assert winner == team_1  # team_a (seed 1, the better seed) wins a tie


async def test_resolve_ready_playoff_matchups_advances_winner_to_next_round(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=1)
    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    # Semifinal 1 (slot 0): team_1 beats team_4.
    await _score_playoff_week(pool, 3, team_1, team_4, 100, 90)
    async with pool.acquire() as conn:
        await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        final_after_one_semi = await conn.fetchrow(
            "SELECT team_a_id, team_b_id FROM playoff_bracket_matchups WHERE season = $1 AND round = 2",
            TEST_SEASON,
        )
    assert final_after_one_semi["team_a_id"] == team_1
    assert final_after_one_semi["team_b_id"] is None  # other semifinal not resolved yet

    # No round-2 matchup weeks yet — only one feeder is known.
    async with pool.acquire() as conn:
        round_2_weeks = await conn.fetchval(
            "SELECT count(*) FROM matchups m JOIN playoff_bracket_matchups b ON m.playoff_bracket_matchup_id = b.id "
            "WHERE b.season = $1 AND b.round = 2",
            TEST_SEASON,
        )
    assert round_2_weeks == 0

    # Semifinal 2 (slot 1): team_2 beats team_3.
    await _score_playoff_week(pool, 3, team_2, team_3, 95, 85)
    async with pool.acquire() as conn:
        resolved = await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        final_after_both = await conn.fetchrow(
            "SELECT team_a_id, team_b_id FROM playoff_bracket_matchups WHERE season = $1 AND round = 2",
            TEST_SEASON,
        )
        final_week_row = await conn.fetchrow(
            "SELECT week, home_team_id, away_team_id FROM matchups m "
            "JOIN playoff_bracket_matchups b ON m.playoff_bracket_matchup_id = b.id "
            "WHERE b.season = $1 AND b.round = 2",
            TEST_SEASON,
        )
    assert len(resolved) == 1  # only semifinal 2 resolved this call
    assert final_after_both["team_a_id"] == team_1
    assert final_after_both["team_b_id"] == team_2
    assert final_week_row["week"] == 4  # round 2 starts right after round 1's single week
    assert {final_week_row["home_team_id"], final_week_row["away_team_id"]} == {team_1, team_2}


async def test_resolve_ready_playoff_matchups_is_idempotent(pool):
    team_1, team_2, team_3, team_4 = await _four_team_bracket_fixture(pool)
    await _set_playoff_settings(pool, playoff_team_count=4, weeks_per_matchup=1)
    async with pool.acquire() as conn:
        await playoffs.generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    await _score_playoff_week(pool, 3, team_1, team_4, 100, 90)
    async with pool.acquire() as conn:
        first = await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        second = await playoffs.resolve_ready_playoff_matchups(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
    assert len(first) == 1
    assert second == []
