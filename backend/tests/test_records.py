from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import TEST_SEASON

# Every test here deliberately stays on TEST_SEASON only — see
# conftest.py's TEST_SEASON comment: cleanup only ever scopes by
# `season = TEST_SEASON`, so seeding a second season leaves matchups/
# teams_by_season rows behind that the owner cleanup step can't delete
# (still FK-referenced), which cascades into every later test in the
# run. /records itself has no season filter at all (that's the whole
# point — "all-time" spans every season), which is already obvious
# from reading app/queries/records.py; no test needs a second season
# to prove it.


async def _get(path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-records-owner-{suffix}", f"Owner {suffix}",
        )


async def _seed_team(pool, owner_id, suffix, season=TEST_SEASON):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 400 + suffix, owner_id, f"Team {suffix}",
        )


async def _seed_matchup(pool, season, week, home_id, away_id, home_score, away_score):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, $2, $3, $4, $5, $6, FALSE)
            """,
            season, week, home_id, away_id, home_score, away_score,
        )


async def test_highest_and_lowest_week_exclude_unplayed_zero_zero(pool):
    owner_a = await _seed_owner(pool, 1)
    owner_b = await _seed_owner(pool, 2)
    team_a = await _seed_team(pool, owner_a, 1)
    team_b = await _seed_team(pool, owner_b, 2)

    await _seed_matchup(pool, TEST_SEASON, 1, team_a, team_b, 187.4, 55.2)
    await _seed_matchup(pool, TEST_SEASON, 2, team_a, team_b, 12.1, 60.0)
    await _seed_matchup(pool, TEST_SEASON, 3, team_a, team_b, 0, 0)  # unplayed — must be excluded from both ends

    resp = await _get("/records")
    assert resp.status_code == 200
    categories = {c["key"]: c for c in resp.json()["categories"]}

    highest = categories["highest_week"]["entries"]
    assert highest[0]["value"] == 187.4
    assert highest[0]["team_name"] == "Team 1"
    assert highest[0]["owner_name"] == "Owner 1"
    assert highest[0]["week"] == 1
    assert all(e["value"] != 0 for e in highest)  # the 0-0 week never shows up

    lowest = categories["lowest_week"]["entries"]
    assert lowest[0]["value"] == 12.1
    assert all(e["value"] != 0 for e in lowest)


async def test_biggest_blowout_orients_to_winner_and_loser(pool):
    owner_a = await _seed_owner(pool, 3)
    owner_b = await _seed_owner(pool, 4)
    team_a = await _seed_team(pool, owner_a, 3)
    team_b = await _seed_team(pool, owner_b, 4)

    await _seed_matchup(pool, TEST_SEASON, 5, team_a, team_b, 150.0, 40.0)

    resp = await _get("/records")
    entry = resp.json()["categories"][2]["entries"][0]
    assert entry["team_name"] == "Team 3"
    assert entry["owner_name"] == "Owner 3"
    assert entry["value"] == 110.0  # margin
    assert entry["own_score"] == 150.0
    assert entry["opponent_team_name"] == "Team 4"
    assert entry["opponent_score"] == 40.0


async def test_season_total_sums_both_home_and_away_appearances(pool):
    owner_a = await _seed_owner(pool, 5)
    owner_b = await _seed_owner(pool, 6)
    team_a = await _seed_team(pool, owner_a, 5)
    team_b = await _seed_team(pool, owner_b, 6)

    # team_a is home in week 1, away in week 2 — both must count toward its season total.
    await _seed_matchup(pool, TEST_SEASON, 1, team_a, team_b, 100.0, 90.0)
    await _seed_matchup(pool, TEST_SEASON, 2, team_b, team_a, 80.0, 120.0)

    resp = await _get("/records")
    season_total = resp.json()["categories"][3]["entries"][0]
    assert season_total["team_name"] == "Team 5"
    assert season_total["value"] == 220.0  # 100 + 120, home and away both counted
