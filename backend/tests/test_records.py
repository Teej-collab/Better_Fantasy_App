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
#
# Because of that same "no season filter" fact, every "our seeded row
# is the #1 entry" assertion below is implicitly racing the league's
# real all-time history, which only ever grows. Single-week/blowout/
# season-total values here are deliberately far outside any real
# fantasy score specifically so that race can never be lost — a real
# score reaching into the thousands isn't a real risk to plan around.


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


async def _seed_matchup(pool, season, week, home_id, away_id, home_score, away_score, *, is_playoff=False):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            season, week, home_id, away_id, home_score, away_score, is_playoff,
        )


async def test_highest_and_lowest_week_exclude_unplayed_zero_zero(pool):
    owner_a = await _seed_owner(pool, 1)
    owner_b = await _seed_owner(pool, 2)
    team_a = await _seed_team(pool, owner_a, 1)
    team_b = await _seed_team(pool, owner_b, 2)

    await _seed_matchup(pool, TEST_SEASON, 1, team_a, team_b, 9500.4, 55.2)
    await _seed_matchup(pool, TEST_SEASON, 2, team_a, team_b, 12.1, 60.0)
    await _seed_matchup(pool, TEST_SEASON, 3, team_a, team_b, 0, 0)  # unplayed — must be excluded from both ends

    resp = await _get("/records")
    assert resp.status_code == 200
    categories = {c["key"]: c for c in resp.json()["categories"]}

    highest = categories["highest_week"]["entries"]
    assert highest[0]["value"] == 9500.4
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

    await _seed_matchup(pool, TEST_SEASON, 5, team_a, team_b, 9150.0, 40.0)

    resp = await _get("/records")
    entry = resp.json()["categories"][2]["entries"][0]
    assert entry["team_name"] == "Team 3"
    assert entry["owner_name"] == "Owner 3"
    assert entry["value"] == 9110.0  # margin
    assert entry["own_score"] == 9150.0
    assert entry["opponent_team_name"] == "Team 4"
    assert entry["opponent_score"] == 40.0


async def test_playoff_matchups_excluded_from_every_category(pool):
    owner_a = await _seed_owner(pool, 7)
    owner_b = await _seed_owner(pool, 8)
    team_a = await _seed_team(pool, owner_a, 7)
    team_b = await _seed_team(pool, owner_b, 8)

    # /records has no season filter at all — "all-time" spans the league's
    # real history too (see the module docstring above), so an assertion
    # like "our seeded score is the #1 entry" would be comparing against
    # whatever the real league's actual all-time bests happen to be, not
    # just this test's own fixture data. These values are deliberately
    # far outside any real single-week fantasy score (a few hundred
    # points, tops) specifically so they're unambiguous regardless of
    # what real history contains: the regular-season one must always
    # rank #1 across every category, and the playoff one must never
    # appear anywhere if the fix works, full stop.
    await _seed_matchup(pool, TEST_SEASON, 1, team_a, team_b, 9000.0, 10.0)
    await _seed_matchup(pool, TEST_SEASON, 16, team_a, team_b, 9999.0, 1.0, is_playoff=True)

    resp = await _get("/records")
    categories = {c["key"]: c for c in resp.json()["categories"]}

    highest = categories["highest_week"]["entries"]
    assert all(e["value"] != 9999.0 for e in highest)
    assert highest[0]["value"] == 9000.0
    assert highest[0]["owner_name"] == "Owner 7"

    blowouts = categories["biggest_blowout"]["entries"]
    assert all(e["value"] != 9998.0 for e in blowouts)
    assert blowouts[0]["value"] == 8990.0

    season_total = categories["season_total"]["entries"][0]
    assert season_total["value"] == 9000.0  # not 18999.0 — the playoff week's score never counts


async def test_season_total_sums_both_home_and_away_appearances(pool):
    owner_a = await _seed_owner(pool, 5)
    owner_b = await _seed_owner(pool, 6)
    team_a = await _seed_team(pool, owner_a, 5)
    team_b = await _seed_team(pool, owner_b, 6)

    # team_a is home in week 1, away in week 2 — both must count toward its season total.
    await _seed_matchup(pool, TEST_SEASON, 1, team_a, team_b, 9100.0, 90.0)
    await _seed_matchup(pool, TEST_SEASON, 2, team_b, team_a, 80.0, 120.0)

    resp = await _get("/records")
    season_total = resp.json()["categories"][3]["entries"][0]
    assert season_total["team_name"] == "Team 5"
    assert season_total["value"] == 9220.0  # 9100 + 120, home and away both counted
