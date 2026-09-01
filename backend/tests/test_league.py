from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import TEST_SEASON


async def _get(path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def _seed_two_teams(pool):
    async with pool.acquire() as conn:
        owner_a = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-league-owner-a", "Alice Smith",
        )
        owner_b = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-league-owner-b", "Bob Jones",
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 101, owner_a, "Team Alpha",
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 102, owner_b, "Team Beta",
        )
    return team_a, team_b


async def test_seasons_and_teams(pool):
    team_a, team_b = await _seed_two_teams(pool)

    resp = await _get("/seasons")
    assert resp.status_code == 200
    assert TEST_SEASON in resp.json()["seasons"]

    resp = await _get(f"/seasons/{TEST_SEASON}/teams")
    assert resp.status_code == 200
    names = {t["team_name"] for t in resp.json()["teams"]}
    assert names == {"Team Alpha", "Team Beta"}


async def test_standings_computed_from_matchups(pool):
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120.5, 100.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings")
    assert resp.status_code == 200
    standings = {row["team_id"]: row for row in resp.json()["standings"]}

    assert standings[team_a]["wins"] == 1
    assert standings[team_a]["losses"] == 0
    assert float(standings[team_a]["points_for"]) == 120.5

    assert standings[team_b]["wins"] == 0
    assert standings[team_b]["losses"] == 1
    assert float(standings[team_b]["points_for"]) == 100.0


async def test_standings_playoff_team_count_is_none_with_no_prior_playoff_data(pool):
    await _seed_two_teams(pool)

    resp = await _get(f"/seasons/{TEST_SEASON}/standings")
    assert resp.status_code == 200
    assert resp.json()["playoff_team_count"] is None


async def test_standings_playoff_team_count_from_most_recent_prior_season(pool):
    """A brand-new season's standings page has no playoff bracket of
    its own yet — the "playoff line" it shows has to come from the
    real, most recently completed prior season's own bracket
    (matchups.is_playoff), not a guess."""
    prior_season = TEST_SEASON - 1
    async with pool.acquire() as conn:
        owners = []
        teams = []
        for i in range(4):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-league-playoff-owner-{i}", f"Playoff Owner {i}",
            )
            team_id = await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
                prior_season, 200 + i, owner_id, f"Playoff Team {i}",
            )
            owners.append(owner_id)
            teams.append(team_id)

        # 2 playoff matchups among the 4 teams — a real 4-team bracket.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 15, $2, $3, 100.0, 90.0, TRUE)",
            prior_season, teams[0], teams[1],
        )
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 15, $2, $3, 80.0, 70.0, TRUE)",
            prior_season, teams[2], teams[3],
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings")
    assert resp.status_code == 200
    assert resp.json()["playoff_team_count"] == 4


async def test_standings_ordered_by_final_rank_when_present(pool):
    # Real-world case this guards against: 2024's actual champion was
    # seeded 4th by regular-season record. final_standings (ESPN's own
    # computed final rank) must win over win/loss ordering.
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        # Team A has the worse record...
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $3, $2, 130.0, 90.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        # ...but won the championship (final_rank 1), so should rank first.
        await conn.execute(
            "INSERT INTO final_standings (season, team_id, final_rank) VALUES ($1, $2, 1)",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO final_standings (season, team_id, final_rank) VALUES ($1, $2, 2)",
            TEST_SEASON, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings")
    body = resp.json()["standings"]
    assert [row["team_id"] for row in body] == [team_a, team_b]
    assert body[0]["final_rank"] == 1
    assert body[0]["wins"] == 0  # confirms it's really final_rank driving order, not win/loss


async def test_standings_falls_back_to_record_when_no_final_rank(pool):
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 130.0, 90.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings")
    body = resp.json()["standings"]
    assert body[0]["team_id"] == team_a
    assert body[0]["final_rank"] is None


async def test_standings_excludes_unplayed_zero_zero_games(pool):
    # ESPN returns 0/0 (not NULL) for matchups that haven't been played
    # yet — a 0-0 "tie" should not be counted.
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 110.0, 90.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 2, $2, $3, 0, 0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings")
    standings = {row["team_id"]: row for row in resp.json()["standings"]}

    assert standings[team_a]["wins"] == 1
    assert standings[team_a]["losses"] == 0
    assert standings[team_a]["ties"] == 0
    assert standings[team_b]["wins"] == 0
    assert standings[team_b]["losses"] == 1
    assert standings[team_b]["ties"] == 0


async def test_roster_ordered_like_espn_lineup(pool):
    team_a, _ = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        # Insert deliberately out of order to prove sorting, not insert order.
        for name, slot in [
            ("Bench Guy", "BE"),
            ("Kicker", "K"),
            ("Flex Guy", "RB/WR/TE"),
            ("Tight End", "TE"),
            ("Wide Out 2", "WR"),
            ("Wide Out 1", "WR"),
            ("Running Back 2", "RB"),
            ("Running Back 1", "RB"),
            ("Quarterback", "QB"),
            ("IR Guy", "IR"),
            ("Defense", "D/ST"),
        ]:
            await conn.execute(
                """
                INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected)
                VALUES ($1, 1, $2, $3, 'X', $4, 1.0, 1.0)
                """,
                TEST_SEASON, team_a, name, slot,
            )

    resp = await _get(f"/teams/{team_a}/roster?week=1")
    slots_in_order = [p["lineup_slot"] for p in resp.json()["roster"]]
    assert slots_in_order == [
        "QB", "RB", "RB", "WR", "WR", "TE", "RB/WR/TE", "D/ST", "K", "BE", "IR",
    ]


async def test_matchup_detail_includes_both_rosters(pool):
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120.5, 100.0, FALSE)
            RETURNING id
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            """
            INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected)
            VALUES ($1, 1, $2, 'Star Runner', 'RB', 'RB', 20.5, 18.0)
            """,
            TEST_SEASON, team_a,
        )
        await conn.execute(
            """
            INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected)
            VALUES ($1, 1, $2, 'Backup Guy', 'WR', 'WR', 10.0, 9.0)
            """,
            TEST_SEASON, team_b,
        )

    resp = await _get(f"/matchups/{matchup_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["home"]["team_name"] == "Team Alpha"
    assert body["away"]["team_name"] == "Team Beta"
    assert [p["player_name"] for p in body["home"]["roster"]] == ["Star Runner"]
    assert [p["player_name"] for p in body["away"]["roster"]] == ["Backup Guy"]


async def test_matchup_detail_roster_includes_espn_player_id_and_pro_team(pool):
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120.5, 100.0, FALSE)
            RETURNING id
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            """
            INSERT INTO rosters
                (season, week, team_id, player_name, position, lineup_slot, points_scored,
                 points_projected, espn_player_id, pro_team)
            VALUES ($1, 1, $2, 'Star Runner', 'RB', 'RB', 20.5, 18.0, 4567, 'KC')
            """,
            TEST_SEASON, team_a,
        )
        # A row synced before this column existed — player_id/pro_team stay
        # NULL rather than erroring, same as any pre-migration historical row.
        await conn.execute(
            """
            INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected)
            VALUES ($1, 1, $2, 'Backup Guy', 'WR', 'WR', 10.0, 9.0)
            """,
            TEST_SEASON, team_b,
        )

    resp = await _get(f"/matchups/{matchup_id}")
    body = resp.json()
    assert body["home"]["roster"][0]["player_id"] == 4567
    assert body["home"]["roster"][0]["pro_team"] == "KC"
    assert body["away"]["roster"][0]["player_id"] is None
    assert body["away"]["roster"][0]["pro_team"] is None


async def test_matchup_detail_includes_win_probability_boom_bust_and_scoped_bench_crime(pool):
    team_a, team_b = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        # A third, unrelated team in the same week — its own bench
        # crime must never leak into team_a/team_b's matchup detail,
        # even though it's the same week and objectively "worse."
        owner_c = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-league-owner-c", "Cara Lee",
        )
        team_c = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 103, owner_c, "Team Gamma",
        )

        matchup_id = await conn.fetchval(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 9, $2, $3, 120.0, 100.0, FALSE)
            RETURNING id
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            """
            INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected, is_boom)
            VALUES ($1, 9, $2, 'Boom Guy', 'RB', 'RB', 35.0, 15.0, TRUE)
            """,
            TEST_SEASON, team_a,
        )
        await conn.execute(
            """
            INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected, is_bust)
            VALUES ($1, 9, $2, 'Bust Guy', 'WR', 'WR', 2.0, 15.0, TRUE)
            """,
            TEST_SEASON, team_b,
        )
        await conn.execute(
            """
            INSERT INTO bench_crimes (season, week, team_id, bench_player, started_player, position, points_diff, severity)
            VALUES ($1, 9, $2, 'Bench Star', 'Starter Guy', 'WR', 12.0, 'Low Misdemeanor')
            """,
            TEST_SEASON, team_a,
        )
        await conn.execute(
            """
            INSERT INTO bench_crimes (season, week, team_id, bench_player, started_player, position, points_diff, severity)
            VALUES ($1, 9, $2, 'Other Bench Star', 'Other Starter', 'RB', 40.0, 'Felony Bench Crime')
            """,
            TEST_SEASON, team_c,
        )

    resp = await _get(f"/matchups/{matchup_id}")
    assert resp.status_code == 200
    body = resp.json()

    # Win probability: real, non-zero scores → both sides get a value,
    # complementary (sums to exactly 100), home (the higher scorer)
    # favored.
    assert body["home"]["win_probability"] is not None
    assert body["away"]["win_probability"] is not None
    assert round(body["home"]["win_probability"] + body["away"]["win_probability"], 1) == 100.0
    assert body["home"]["win_probability"] > body["away"]["win_probability"]

    # Boom/bust flags land on the right player.
    assert body["home"]["roster"][0]["is_boom"] is True
    assert body["away"]["roster"][0]["is_bust"] is True

    # Bench crime scoped to just this matchup's two teams.
    assert body["home"]["bench_crime"]["bench_player"] == "Bench Star"
    assert body["away"]["bench_crime"] is None


async def test_matchup_detail_404_for_unknown_id(pool):
    resp = await _get("/matchups/999999999")
    assert resp.status_code == 404


async def test_team_roster_endpoint(pool):
    team_a, _ = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO rosters
                (season, week, team_id, player_name, position, lineup_slot, points_scored,
                 points_projected, espn_player_id, pro_team)
            VALUES ($1, 3, $2, 'Star Runner', 'RB', 'RB', 20.5, 18.0, 4567, 'KC')
            """,
            TEST_SEASON, team_a,
        )

    resp = await _get(f"/teams/{team_a}/roster?week=3")
    assert resp.status_code == 200
    body = resp.json()
    assert body["team"]["team_name"] == "Team Alpha"
    assert body["week"] == 3
    assert [p["player_name"] for p in body["roster"]] == ["Star Runner"]
    assert body["roster"][0]["player_id"] == 4567
    assert body["roster"][0]["pro_team"] == "KC"


async def test_team_detail_404_for_unknown_id(pool):
    resp = await _get("/teams/999999999")
    assert resp.status_code == 404
