from httpx import ASGITransport, AsyncClient

from app.domain.chug_leaderboard import build_chug_leaderboard
from app.main import app
from tests.conftest import TEST_SEASON

PAST_SEASON = TEST_SEASON - 1


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_owner(pool, suffix, discord_user_id):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-chugboard-owner-{suffix}", f"Owner {suffix}", discord_user_id,
        )


async def test_past_season_assumes_full_completion(pool):
    owner_id = await _seed_owner(pool, 1, 111)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 3)",
            PAST_SEASON, owner_id,
        )
        # No chug_scores at all for this owner/season — past seasons don't
        # have video proof, and completion should still read as 100%.
        leaderboard = await build_chug_leaderboard(conn, active_season=TEST_SEASON, season=PAST_SEASON)
        await conn.execute("DELETE FROM chug_debts WHERE season = $1", PAST_SEASON)

    entry = next(t for t in leaderboard if t["owner_id"] == owner_id)
    assert entry["owed"] == 3
    assert entry["completed"] == 3
    assert entry["avg_grade"] is None


async def test_active_season_uses_real_completion_capped_at_owed(pool):
    owner_id = await _seed_owner(pool, 2, 222)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)",
            TEST_SEASON, owner_id,
        )
        # 3 real graded videos, but only 2 were actually owed -> completed
        # caps at 2, not 3.
        for score in (7.5, 8.0, 6.5):
            await conn.execute(
                "INSERT INTO chug_scores (discord_user_id, final_score, season, week) VALUES (222, $1, $2, 1)",
                score, TEST_SEASON,
            )

        leaderboard = await build_chug_leaderboard(conn, active_season=TEST_SEASON, season=TEST_SEASON)
        await conn.execute("DELETE FROM chug_debts WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM chug_scores WHERE season = $1", TEST_SEASON)

    entry = next(t for t in leaderboard if t["owner_id"] == owner_id)
    assert entry["owed"] == 2
    assert entry["completed"] == 2
    assert entry["avg_grade"] == 7.33


async def test_active_season_with_no_videos_yet_shows_zero_completed(pool):
    owner_id = await _seed_owner(pool, 3, 333)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 1)",
            TEST_SEASON, owner_id,
        )
        leaderboard = await build_chug_leaderboard(conn, active_season=TEST_SEASON, season=TEST_SEASON)
        await conn.execute("DELETE FROM chug_debts WHERE season = $1", TEST_SEASON)

    entry = next(t for t in leaderboard if t["owner_id"] == owner_id)
    assert entry["owed"] == 1
    assert entry["completed"] == 0
    assert entry["avg_grade"] is None


async def test_all_time_view_sums_across_seasons(pool):
    owner_id = await _seed_owner(pool, 4, 444)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)",
            PAST_SEASON, owner_id,
        )
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 1)",
            TEST_SEASON, owner_id,
        )
        leaderboard = await build_chug_leaderboard(conn, active_season=TEST_SEASON, season=None)
        await conn.execute("DELETE FROM chug_debts WHERE season IN ($1, $2)", PAST_SEASON, TEST_SEASON)

    entry = next(t for t in leaderboard if t["owner_id"] == owner_id)
    # past season (2 owed) assumed complete + active season (1 owed, 0 real
    # completions) not complete -> 3 owed, 2 completed overall.
    assert entry["owed"] == 3
    assert entry["completed"] == 2


async def test_leaderboard_endpoint_returns_seasons_and_rows(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 5, 555)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 4)",
            TEST_SEASON, owner_id,
        )

    async with _client() as client:
        seasons_resp = await client.get("/chug/seasons")
        board_resp = await client.get(f"/chug/leaderboard?season={TEST_SEASON}")

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM chug_debts WHERE season = $1", TEST_SEASON)

    assert seasons_resp.status_code == 200
    assert TEST_SEASON in seasons_resp.json()["seasons"]

    assert board_resp.status_code == 200
    body = board_resp.json()
    assert body["season"] == TEST_SEASON
    assert any(row["owner_id"] == owner_id and row["owed"] == 4 for row in body["leaderboard"])
