from app.domain.season_awards import (
    compute_boom_bust_weeks,
    compute_bullseye,
    compute_longest_streaks,
    compute_over_underachiever,
    compute_season_awards_for_season,
    compute_season_champion,
    determine_and_save_season_awards,
)
from tests.conftest import TEST_SEASON


async def _seed_owner_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-seasonaward-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 800 + suffix, owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def _seed_projection(pool, team_id, week, projected):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO weekly_team_stats (season, week, team_id, team_points_projected)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (season, week, team_id) DO UPDATE SET team_points_projected = EXCLUDED.team_points_projected
            """,
            TEST_SEASON, week, team_id, projected,
        )


async def test_compute_over_underachiever_uses_expected_score(pool):
    owner_id, team_id = await _seed_owner_team(pool, 1)
    _, opp_id = await _seed_owner_team(pool, 2)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 130, 90)",
            TEST_SEASON, team_id, opp_id,
        )
    await _seed_projection(pool, team_id, 1, 100)

    async with pool.acquire() as conn:
        diff = await compute_over_underachiever(conn, TEST_SEASON, owner_id)
    assert diff == 30.0  # scored 130 against a 100 projection


async def test_compute_over_underachiever_none_for_unplayed_season(pool):
    owner_id, _ = await _seed_owner_team(pool, 3)
    async with pool.acquire() as conn:
        assert await compute_over_underachiever(conn, TEST_SEASON, owner_id) is None


async def test_compute_boom_bust_weeks_excludes_playoffs(pool):
    owner_id, team_id = await _seed_owner_team(pool, 4)
    _, opp_id = await _seed_owner_team(pool, 5)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $3, 80, 70, FALSE)",
            TEST_SEASON, team_id, opp_id,
        )
        # A playoff blowout that should NOT count as the season-high week.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 2, $2, $3, 200, 10, TRUE)",
            TEST_SEASON, team_id, opp_id,
        )
        result = await compute_boom_bust_weeks(conn, TEST_SEASON, owner_id)
    assert result == {"best_week": 80.0, "worst_week": 80.0}


async def test_compute_longest_streaks(pool):
    owner_id, team_id = await _seed_owner_team(pool, 6)
    _, opp_id = await _seed_owner_team(pool, 7)

    async with pool.acquire() as conn:
        # W, W, L, W, W, W -> longest win streak 3, longest loss streak 1.
        results = [(120, 90), (110, 80), (60, 90), (100, 50), (100, 60), (100, 70)]
        for week, (my_score, opp_score) in enumerate(results, start=1):
            await conn.execute(
                "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                TEST_SEASON, week, team_id, opp_id, my_score, opp_score,
            )
        streaks = await compute_longest_streaks(conn, TEST_SEASON, owner_id)
    assert streaks == {"longest_win_streak": 3, "longest_loss_streak": 1}


async def test_compute_bullseye_counts_weeks_within_half_point(pool):
    owner_id, team_id = await _seed_owner_team(pool, 8)
    _, opp_id = await _seed_owner_team(pool, 9)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 100.3, 90)",
            TEST_SEASON, team_id, opp_id,
        )
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 2, $2, $3, 120, 90)",
            TEST_SEASON, team_id, opp_id,
        )
    await _seed_projection(pool, team_id, 1, 100.0)  # within 0.5 -> bullseye
    await _seed_projection(pool, team_id, 2, 100.0)  # 20 off -> not

    async with pool.acquire() as conn:
        count = await compute_bullseye(conn, TEST_SEASON, owner_id)
    assert count == 1


async def test_determine_and_save_season_awards_picks_best_owner(pool):
    owner_a, team_a = await _seed_owner_team(pool, 10)
    owner_b, team_b = await _seed_owner_team(pool, 11)

    async with pool.acquire() as conn:
        # Owner A blows out owner B -> A gets Boom Week / B gets Bust Week
        # (also the season's only result for each, so Heater/Cold Streak
        # both land on the same two owners deterministically).
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 200, 20)",
            TEST_SEASON, team_a, team_b,
        )
        winners = await determine_and_save_season_awards(conn, TEST_SEASON)

        row = await conn.fetchrow(
            "SELECT owner_id FROM season_awards WHERE season = $1 AND award_type = 'Boom Week'", TEST_SEASON
        )
    assert row["owner_id"] == owner_a
    assert "Boom Week" in winners


async def test_compute_season_champion_noop_without_final_standings(pool):
    async with pool.acquire() as conn:
        saved = await compute_season_champion(conn, TEST_SEASON)
    assert saved is False


async def test_compute_season_champion_saves_final_rank_one(pool):
    owner_id, team_id = await _seed_owner_team(pool, 12)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO final_standings (season, team_id, final_rank) VALUES ($1, $2, 1)", TEST_SEASON, team_id
        )
        saved = await compute_season_champion(conn, TEST_SEASON)

        row = await conn.fetchrow(
            "SELECT owner_id, team_name FROM season_champions WHERE season = $1", TEST_SEASON
        )
    assert saved is True
    assert row["owner_id"] == owner_id


async def test_compute_season_awards_for_season_end_to_end(pool):
    owner_a, team_a = await _seed_owner_team(pool, 13)
    owner_b, team_b = await _seed_owner_team(pool, 14)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 150, 60)",
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO final_standings (season, team_id, final_rank) VALUES ($1, $2, 1)", TEST_SEASON, team_a
        )

    award_count = await compute_season_awards_for_season(pool, TEST_SEASON)
    assert award_count > 0

    async with pool.acquire() as conn:
        champion = await conn.fetchval(
            "SELECT owner_id FROM season_champions WHERE season = $1", TEST_SEASON
        )
    assert champion == owner_a
