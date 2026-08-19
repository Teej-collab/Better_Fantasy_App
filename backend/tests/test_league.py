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
    assert body["home_team_name"] == "Team Alpha"
    assert body["away_team_name"] == "Team Beta"
    assert [p["player_name"] for p in body["home_roster"]] == ["Star Runner"]
    assert [p["player_name"] for p in body["away_roster"]] == ["Backup Guy"]


async def test_matchup_detail_404_for_unknown_id(pool):
    resp = await _get("/matchups/999999999")
    assert resp.status_code == 404


async def test_team_roster_endpoint(pool):
    team_a, _ = await _seed_two_teams(pool)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected)
            VALUES ($1, 3, $2, 'Star Runner', 'RB', 'RB', 20.5, 18.0)
            """,
            TEST_SEASON, team_a,
        )

    resp = await _get(f"/teams/{team_a}/roster?week=3")
    assert resp.status_code == 200
    body = resp.json()
    assert body["team"]["team_name"] == "Team Alpha"
    assert body["week"] == 3
    assert [p["player_name"] for p in body["roster"]] == ["Star Runner"]


async def test_team_detail_404_for_unknown_id(pool):
    resp = await _get("/teams/999999999")
    assert resp.status_code == 404
