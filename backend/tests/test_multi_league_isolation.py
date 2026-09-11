"""Proves the constraint-widening in migration 130f4acc3a50 actually
does what it's for: two leagues sharing the same real-world season can
each independently hold a row that would have collided under the old,
season-only-scoped unique constraints — a real person's roster pick,
a draft's pick_number=1, a league's own scoring rule, a chug debt.
Without this widening, the second league's write would fail outright
(a real UniqueViolation) or silently overwrite the first's data.
"""
TEST_SEASON = 1900  # matches conftest.TEST_SEASON

# Every league created below is named "Test League ..." specifically so
# conftest.py's cleanup_test_season fixture sweeps it (and its
# league_members rows) up automatically — see that fixture's own
# comment on the naming convention it relies on.


async def test_two_leagues_can_each_roster_the_same_real_player(pool):
    """The exact scenario the season-only current_rosters constraint
    used to block: the same real NFL player (same sleeper_player_id)
    rostered in two different leagues for the same season."""
    from app.queries import leagues as league_queries

    async with pool.acquire() as conn:
        league_a = await league_queries.create_league(conn, "Test League Isolation A", 1, "iso-a-code")
        league_b = await league_queries.create_league(conn, "Test League Isolation B", 1, "iso-b-code")

        await conn.execute(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-iso-owner", "Iso Owner",
        )
        owner_id = await conn.fetchval("SELECT owner_id FROM owners WHERE espn_member_id = 'test-iso-owner'")
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position) VALUES ('test-iso-player', 'Iso Player', 'RB')"
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Team A', $3) RETURNING id",
            TEST_SEASON, owner_id, league_a,
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Team B', $3) RETURNING id",
            TEST_SEASON, owner_id, league_b,
        )

        # Same real player, same season, two different leagues — this
        # INSERT into league B would have violated the old (season,
        # sleeper_player_id) UNIQUE constraint the instant league A's
        # row already existed.
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, 'test-iso-player', 'BE', 'free_agent', $3)",
            TEST_SEASON, team_a, league_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, 'test-iso-player', 'BE', 'free_agent', $3)",
            TEST_SEASON, team_b, league_b,
        )

        rows = await conn.fetch(
            "SELECT league_id FROM current_rosters WHERE season = $1 AND sleeper_player_id = 'test-iso-player' "
            "ORDER BY league_id",
            TEST_SEASON,
        )
        assert [r["league_id"] for r in rows] == sorted([league_a, league_b])

        # cleanup (this test's own rows, before the session-wide fixture runs)
        await conn.execute("DELETE FROM current_rosters WHERE sleeper_player_id = 'test-iso-player'")
        await conn.execute("DELETE FROM teams_by_season WHERE id = ANY($1::int[])", [team_a, team_b])
        await conn.execute("DELETE FROM owners WHERE owner_id = $1", owner_id)


async def test_two_leagues_with_the_same_player_dont_double_count_each_others_points(pool):
    """The real live bug this fixes (2026-09-10, real incident reported
    against production: a player doubled on a roster, points inflated).
    Once two leagues both have a computed player_week_stats row for the
    same real player/week — exactly what the widened constraint above
    exists to allow, each with its own league's scoring rules — every
    roster/score read that joined player_week_stats without ALSO
    scoping the join itself by league_id fanned out to both leagues'
    rows: doubling the player on screen (get_roster), and summing both
    leagues' points into this league's real computed score
    (matchup_scoring.compute_team_score). current_rosters is already
    correctly one-row-per-league (see the roster test above) — the
    fan-out happens at the player_week_stats join, not before it, so
    scoping current_rosters alone was never enough."""
    from app.domain import matchup_scoring
    from app.domain.lineup_engine import get_roster
    from app.queries import leagues as league_queries

    async with pool.acquire() as conn:
        league_a = await league_queries.create_league(conn, "Test League Double A", 1, "dbl-a-code")
        league_b = await league_queries.create_league(conn, "Test League Double B", 1, "dbl-b-code")

        await conn.execute(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2)",
            "test-dbl-owner", "Dbl Owner",
        )
        owner_id = await conn.fetchval("SELECT owner_id FROM owners WHERE espn_member_id = 'test-dbl-owner'")
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position) VALUES ('test-dbl-player', 'Dbl Player', 'RB')"
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Team Dbl A', $3) RETURNING id",
            TEST_SEASON, owner_id, league_a,
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Team Dbl B', $3) RETURNING id",
            TEST_SEASON, owner_id, league_b,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, 'test-dbl-player', 'RB', 'free_agent', $3)",
            TEST_SEASON, team_a, league_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, 'test-dbl-player', 'RB', 'free_agent', $3)",
            TEST_SEASON, team_b, league_b,
        )

        # Same real player/week, two different leagues, deliberately
        # different fantasy_points — exactly what the widened
        # player_week_stats constraint exists to allow (different
        # scoring rules per league for the same real game).
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, league_id) "
            "VALUES ($1, 1, 'test-dbl-player', '{}', 10.0, $2)",
            TEST_SEASON, league_a,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, league_id) "
            "VALUES ($1, 1, 'test-dbl-player', '{}', 25.0, $2)",
            TEST_SEASON, league_b,
        )

        roster_a = await get_roster(conn, TEST_SEASON, team_a, week=1)
        roster_b = await get_roster(conn, TEST_SEASON, team_b, week=1)
        assert len(roster_a) == 1  # not doubled
        assert len(roster_b) == 1
        assert float(roster_a[0]["points"]) == 10.0  # league A's own value, not summed with B's
        assert float(roster_b[0]["points"]) == 25.0

        score_a = await matchup_scoring.compute_team_score(conn, TEST_SEASON, 1, team_a)
        score_b = await matchup_scoring.compute_team_score(conn, TEST_SEASON, 1, team_b)
        assert score_a == 10.0  # not 35.0 (summed across both leagues)
        assert score_b == 25.0

        # cleanup (this test's own rows, before the session-wide fixture runs)
        await conn.execute("DELETE FROM player_week_stats WHERE sleeper_player_id = 'test-dbl-player'")
        await conn.execute("DELETE FROM current_rosters WHERE sleeper_player_id = 'test-dbl-player'")
        await conn.execute("DELETE FROM teams_by_season WHERE id = ANY($1::int[])", [team_a, team_b])
        await conn.execute("DELETE FROM owners WHERE owner_id = $1", owner_id)
        await conn.execute("DELETE FROM players WHERE sleeper_player_id = 'test-dbl-player'")


async def test_two_leagues_can_each_have_a_pick_number_one(pool):
    """draft_picks used to be UNIQUE on (season, pick_number) alone —
    every league's draft starts at pick_number=1, so two real drafts
    in the same season would have collided immediately."""
    async with pool.acquire() as conn:
        from app.queries import leagues as league_queries

        league_a = await league_queries.create_league(conn, "Test League Draft A", 1, "draft-a-code")
        league_b = await league_queries.create_league(conn, "Test League Draft B", 1, "draft-b-code")

        await conn.execute(
            "INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, league_id) "
            "VALUES ($1, 1, 1, 1, 1, $2)",
            TEST_SEASON, league_a,
        )
        await conn.execute(
            "INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, league_id) "
            "VALUES ($1, 1, 1, 1, 1, $2)",
            TEST_SEASON, league_b,
        )

        count = await conn.fetchval(
            "SELECT COUNT(*) FROM draft_picks WHERE season = $1 AND pick_number = 1", TEST_SEASON
        )
        assert count == 2


async def test_two_leagues_can_each_have_their_own_scoring_rule_for_the_same_stat(pool):
    """The constraint that actually blocked the scoring-rules seeding
    work this test suite is written alongside — two leagues, same
    season, genuinely different points_per_unit for the same
    stat_category."""
    async with pool.acquire() as conn:
        from app.queries import leagues as league_queries

        league_a = await league_queries.create_league(conn, "Test League Scoring A", 1, "score-a-code")
        league_b = await league_queries.create_league(conn, "Test League Scoring B", 1, "score-b-code")

        await conn.execute(
            "INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id) "
            "VALUES ($1, 'pass_td', 4, $2)",
            TEST_SEASON, league_a,
        )
        await conn.execute(
            "INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id) "
            "VALUES ($1, 'pass_td', 6, $2)",
            TEST_SEASON, league_b,
        )

        value_a = await conn.fetchval(
            "SELECT points_per_unit FROM league_scoring_rules WHERE season = $1 AND stat_category = 'pass_td' "
            "AND league_id = $2",
            TEST_SEASON, league_a,
        )
        value_b = await conn.fetchval(
            "SELECT points_per_unit FROM league_scoring_rules WHERE season = $1 AND stat_category = 'pass_td' "
            "AND league_id = $2",
            TEST_SEASON, league_b,
        )
        assert float(value_a) == 4
        assert float(value_b) == 6
