from app.domain.weekly_team_stats import (
    all_play_pcts,
    compute_chaos_score,
    compute_luck_score,
    compute_power_ranks,
    compute_sos_for_week,
    compute_weekly_team_stats_for_season,
    compute_weekly_team_stats_for_week,
    recent_form,
    team_season_stats,
)
from tests.conftest import TEST_SEASON


def test_compute_luck_score_is_result_minus_all_play():
    # Won with a score that beat only a quarter of the league: lucky.
    assert compute_luck_score(1.0, 0.25) == 37.5
    # Lost with the league's best score: as unlucky as it gets.
    assert compute_luck_score(0.0, 1.0) == -50.0
    # Won with the best score / lost with the worst: no luck either way.
    assert compute_luck_score(1.0, 1.0) == 0.0
    assert compute_luck_score(0.0, 0.0) == 0.0


def test_all_play_pcts_counts_ties_as_half():
    assert all_play_pcts({1: 100.0, 2: 90.0, 3: 90.0}) == {1: 1.0, 2: 0.25, 3: 0.25}


def test_recent_form_weights_the_newest_week_heaviest():
    assert recent_form([100.0, 100.0, 160.0]) == 100 * 0.2 + 100 * 0.3 + 160 * 0.5
    assert recent_form([120.0]) == 120.0


def test_compute_chaos_score_scales_with_swung_starters():
    assert compute_chaos_score(boom_count=2, bust_count=1, total_starters=9) == round(3 / 9 * 100, 2)
    assert compute_chaos_score(0, 0, 9) == 0.0
    assert compute_chaos_score(0, 0, 0) == 0.0


def _stats(team_id, win_pct, all_play_pct, avg_points, recent, margin):
    return {"team_id": team_id, "win_pct": win_pct, "all_play_pct": all_play_pct, "avg_points": avg_points,
            "recent_form": recent, "avg_margin": margin}


def test_compute_power_ranks_orders_best_first():
    ranks = compute_power_ranks([_stats(1, 1.0, 0.9, 120.0, 130.0, 20.0), _stats(2, 0.0, 0.1, 80.0, 70.0, -20.0)])
    assert ranks == {1: 1, 2: 2}


def test_power_ranks_do_not_just_follow_the_standings():
    # 3-1 on luck (worst scorer in the league) vs 1-3 on bad luck (best
    # scorer): the better team ranks higher despite the record.
    lucky = _stats(1, 0.75, 0.30, 98.0, 95.0, -2.0)
    unlucky = _stats(2, 0.25, 0.80, 131.0, 135.0, 6.0)
    middle = _stats(3, 0.5, 0.5, 115.0, 115.0, 0.0)
    ranks = compute_power_ranks([lucky, unlucky, middle])
    assert ranks[2] < ranks[1]


def test_team_season_stats_expected_wins_and_luck():
    games = [
        {"week": 1, "home_team_id": 1, "away_team_id": 2, "home_score": 90, "away_score": 80},
        {"week": 1, "home_team_id": 3, "away_team_id": 4, "home_score": 150, "away_score": 140},
    ]
    stats = team_season_stats(games)
    # Team 1 won with the 3rd-best of 4 scores: 1/3 all-play, lucky.
    assert stats[1]["all_play_pct"] == 1 / 3
    assert round(stats[1]["luck_wins"], 3) == round(1 - 1 / 3, 3)
    # Team 4 lost with the 2nd-best: unlucky.
    assert round(stats[4]["luck_wins"], 3) == round(0 - 2 / 3, 3)
    assert stats[3]["opponents"] == [4]


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
            sleeper_id = f"test-wts-qb-{name}"
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
                "VALUES ($1, $2, 'QB', 'KC', TRUE, 20)",
                sleeper_id, f"QB {name}",
            )
            await conn.execute(
                "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
                "VALUES ($1, $2, $3, 'QB', 'draft')",
                TEST_SEASON, team_id, sleeper_id,
            )

        await compute_weekly_team_stats_for_week(conn, TEST_SEASON, 1)

        rows = {
            r["team_id"]: r
            for r in await conn.fetch(
                "SELECT team_id, power_rank, luck_score, chaos_score, team_points_projected, sos "
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
    # A's only opponent (B) is 0-1 through week 1 -> A's SOS is 0. B's
    # only opponent (A) is 1-0 -> B's SOS is 1.
    assert float(rows[team_a]["sos"]) == 0.0
    assert float(rows[team_b]["sos"]) == 1.0


async def test_compute_sos_excludes_playoff_games(pool):
    _, team_a = await _seed_team(pool, 7)
    _, team_b = await _seed_team(pool, 8)
    _, team_c = await _seed_team(pool, 9)

    async with pool.acquire() as conn:
        # Regular season: A beats B (A is 1-0), sets B's SOS input.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, 100, 80)",
            TEST_SEASON, team_a, team_b,
        )
        # A playoff game the same week number in a later "week" slot:
        # A loses to C, is_playoff=TRUE — must not change A's regular-
        # season win_pct (still 1-0) or count as an opponent for SOS.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 2, $2, $3, 60, 90, TRUE)",
            TEST_SEASON, team_a, team_c,
        )

        count = await compute_sos_for_week(conn, TEST_SEASON, 2)
        sos_by_team = {
            r["team_id"]: r["sos"]
            for r in await conn.fetch(
                "SELECT team_id, sos FROM weekly_team_stats WHERE season = $1 AND week = 2", TEST_SEASON
            )
        }

    # C never appears (its only game was a playoff game, so it has zero
    # regular-season games through week 2) -> not counted at all.
    assert team_c not in sos_by_team
    # A's regular-season record is still just 1-0 vs B -> A's own SOS
    # (an average of ITS opponents, i.e. just B, who is 0-1) is 0.0,
    # unaffected by the playoff loss to C.
    assert float(sos_by_team[team_a]) == 0.0
    # B's only (regular-season) opponent is A, who is 1-0 -> B's SOS is 1.0.
    assert float(sos_by_team[team_b]) == 1.0
    assert count == 2  # A and B get real sos values; C is skipped entirely


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
