from httpx import ASGITransport, AsyncClient

from app.main import app
from app.queries import power_rankings as pr_queries
from tests.conftest import TEST_SEASON

# The all-time leaderboards (get_all_time_indices) have no season
# filter — same "computed live, races real history" situation
# test_records.py documents for /records. Unlike a raw point total,
# though, there's no seedable value that trivially wins a rank-based
# or bounded (-50..50) leaderboard against however many real seasons
# of history exist, so those are tested by calling the query layer
# directly with a large limit and checking OUR test owner's own
# computed value shows up correctly, never by asserting it's #1.


async def _get(path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-powerrank-owner-{suffix}", f"Owner {suffix}",
        )


async def _seed_team(pool, owner_id, suffix, season=TEST_SEASON):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 700 + suffix, owner_id, f"Team {suffix}",
        )


async def _seed_stat(pool, season, week, team_id, *, power_rank=None, luck_score=None, sos=None):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO weekly_team_stats (season, week, team_id, power_rank, luck_score, sos)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            season, week, team_id, power_rank, luck_score, sos,
        )


async def test_week_power_rankings_orders_by_rank_and_computes_movement(pool):
    owner_a = await _seed_owner(pool, 1)
    owner_b = await _seed_owner(pool, 2)
    team_a = await _seed_team(pool, owner_a, 1)
    team_b = await _seed_team(pool, owner_b, 2)

    await _seed_stat(pool, TEST_SEASON, 1, team_a, power_rank=2, luck_score=5.0, sos=0.4)
    await _seed_stat(pool, TEST_SEASON, 1, team_b, power_rank=1, luck_score=-5.0, sos=0.6)
    # Week 2: A climbs to #1, B drops to #2.
    await _seed_stat(pool, TEST_SEASON, 2, team_a, power_rank=1, luck_score=10.0, sos=0.5)
    await _seed_stat(pool, TEST_SEASON, 2, team_b, power_rank=2, luck_score=-10.0, sos=0.5)

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/2/power-rankings")
    assert resp.status_code == 200
    rankings = resp.json()["rankings"]

    assert [r["team_id"] for r in rankings] == [team_a, team_b]  # ordered by power_rank
    first, second = rankings
    assert first["power_rank"] == 1
    assert first["movement"] == 1  # was #2, now #1 -> moved up 1
    assert second["power_rank"] == 2
    assert second["movement"] == -1  # was #1, now #2 -> moved down 1
    assert first["luck_score"] == 10.0
    assert first["sos"] == 0.5


async def test_week_power_rankings_movement_null_with_no_prior_week(pool):
    owner_a = await _seed_owner(pool, 3)
    team_a = await _seed_team(pool, owner_a, 3)
    await _seed_stat(pool, TEST_SEASON, 1, team_a, power_rank=1, luck_score=0.0, sos=0.5)

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/1/power-rankings")
    assert resp.json()["rankings"][0]["movement"] is None


async def test_latest_ranked_week_returns_max_week_with_data(pool):
    owner_a = await _seed_owner(pool, 4)
    team_a = await _seed_team(pool, owner_a, 4)
    await _seed_stat(pool, TEST_SEASON, 1, team_a, power_rank=1)
    await _seed_stat(pool, TEST_SEASON, 3, team_a, power_rank=1)

    resp = await _get(f"/seasons/{TEST_SEASON}/power-rankings/latest-week")
    assert resp.json()["week"] == 3


async def test_season_trend_groups_weeks_by_team(pool):
    owner_a = await _seed_owner(pool, 5)
    team_a = await _seed_team(pool, owner_a, 5)
    await _seed_stat(pool, TEST_SEASON, 1, team_a, power_rank=3)
    await _seed_stat(pool, TEST_SEASON, 2, team_a, power_rank=1)

    resp = await _get(f"/seasons/{TEST_SEASON}/power-rankings/trend")
    teams = {t["team_id"]: t for t in resp.json()["teams"]}
    assert teams[team_a]["weeks"] == [{"week": 1, "power_rank": 3}, {"week": 2, "power_rank": 1}]


async def test_career_avg_power_rank_computes_correct_average(pool):
    owner_a = await _seed_owner(pool, 6)
    team_a = await _seed_team(pool, owner_a, 6)
    for week, rank in enumerate([1, 2, 3, 2], start=1):
        await _seed_stat(pool, TEST_SEASON, week, team_a, power_rank=rank)

    async with pool.acquire() as conn:
        rows = await pr_queries.career_avg_power_rank(conn, limit=10_000, descending=False)
    row = next(r for r in rows if r["owner_id"] == owner_a)
    assert row["weeks"] == 4
    assert float(row["value"]) == 2.0  # (1+2+3+2)/4


async def test_career_avg_power_rank_excludes_owners_under_min_weeks(pool):
    owner_a = await _seed_owner(pool, 7)
    team_a = await _seed_team(pool, owner_a, 7)
    for week in (1, 2):  # only 2 weeks, under the 4-week minimum
        await _seed_stat(pool, TEST_SEASON, week, team_a, power_rank=1)

    async with pool.acquire() as conn:
        rows = await pr_queries.career_avg_power_rank(conn, limit=10_000, descending=False)
    assert not any(r["owner_id"] == owner_a for r in rows)


async def test_most_weeks_at_number_one_counts_only_rank_one(pool):
    owner_a = await _seed_owner(pool, 8)
    team_a = await _seed_team(pool, owner_a, 8)
    for week, rank in enumerate([1, 1, 2, 1], start=1):
        await _seed_stat(pool, TEST_SEASON, week, team_a, power_rank=rank)

    async with pool.acquire() as conn:
        rows = await pr_queries.most_weeks_at_number_one(conn, limit=10_000)
    row = next(r for r in rows if r["owner_id"] == owner_a)
    assert row["value"] == 3


async def test_all_time_indices_endpoint_returns_all_six_categories(pool):
    resp = await _get("/power-rankings/all-time")
    assert resp.status_code == 200
    keys = {c["key"] for c in resp.json()["categories"]}
    assert keys == {
        "most_weeks_at_one",
        "best_career_power_rank",
        "luckiest",
        "unluckiest",
        "toughest_schedule",
        "easiest_schedule",
    }
