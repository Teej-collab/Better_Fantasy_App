from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import TEST_SEASON

# Like test_records.py, GET /awards/all-time has no season filter at all —
# it spans the league's whole real history, not just TEST_SEASON. Unlike
# records.py's numeric leaderboards (where a single huge fixture value can
# safely dominate any real score), season_awards has a UNIQUE (season,
# award_type) constraint — one owner per award per season, so a test can't
# fabricate an arbitrarily large "win count" for one (season, award_type)
# pair the way test_records.py fabricates one huge score. Instead this
# gives its test owner a real season_awards row in each of several distinct
# fake seasons (TEST_SEASON plus a small dedicated range right next to it,
# also reserved sentinel values — see conftest.py's TEST_SEASON comment for
# why 1900 itself can never collide with a real season) so the count is
# large enough to rank #1 regardless of the real league's actual history,
# and cleans those extra seasons up itself since the shared
# cleanup_test_season fixture only ever scopes to TEST_SEASON exactly.
_EXTRA_SEASONS = range(1901, 1910)  # 9 more seasons, alongside TEST_SEASON (1900) = 10 total


async def _get(path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-alltime-award-owner-{suffix}", f"Owner {suffix}",
        )


async def test_all_time_awards_include_every_award_type_even_with_no_wins(pool):
    resp = await _get("/awards/all-time")
    assert resp.status_code == 200
    categories = resp.json()["categories"]
    keys = {c["key"] for c in categories}

    assert "season_champion" in keys
    for award_type in (
        "Clutch Performer", "Choke Artist", "Overachiever", "Underachiever",
        "Boom Week", "Bust Week", "Snakebit Award", "Luckiest Win",
        "Heater", "Cold Streak", "Bullseye Award", "Highway Robbery",
    ):
        assert award_type in keys
    assert len(categories) == 13  # season_champion + the 12 season_awards types

    # Every category is present in the response shape even when nobody in
    # this test run has ever won it — an empty list, not a missing key.
    for c in categories:
        assert isinstance(c["winners"], list)


async def test_all_time_awards_ranks_the_owner_with_the_most_wins_first(pool):
    owner_id = await _seed_owner(pool, 1)
    try:
        async with pool.acquire() as conn:
            for season in [TEST_SEASON, *_EXTRA_SEASONS]:
                await conn.execute(
                    "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, $3, $4)",
                    season, owner_id, "Clutch Performer", "test win",
                )
            for season in [TEST_SEASON, *_EXTRA_SEASONS]:
                await conn.execute(
                    "INSERT INTO season_champions (season, owner_id, team_name) VALUES ($1, $2, $3)",
                    season, owner_id, "Test Champs",
                )

        resp = await _get("/awards/all-time")
        categories = {c["key"]: c for c in resp.json()["categories"]}

        clutch_winners = categories["Clutch Performer"]["winners"]
        assert clutch_winners[0]["owner_id"] == owner_id
        assert clutch_winners[0]["wins"] == 10

        champ_winners = categories["season_champion"]["winners"]
        assert champ_winners[0]["owner_id"] == owner_id
        assert champ_winners[0]["wins"] == 10
    finally:
        async with pool.acquire() as conn:
            for season in _EXTRA_SEASONS:
                await conn.execute("DELETE FROM season_awards WHERE season = $1", season)
                await conn.execute("DELETE FROM season_champions WHERE season = $1", season)
            # TEST_SEASON (1900) itself is cleaned up by the shared
            # cleanup_test_season autouse fixture, same as every other test.
