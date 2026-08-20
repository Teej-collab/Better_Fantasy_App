import pytest
import pytest_asyncio

from app.db import get_pool
from app.providers.espn.config import ESPNConfig

# MUST be a season number that can never be a real league season, ever.
# cleanup_test_season below runs after every single test and does an
# unscoped `DELETE FROM <table> WHERE season = TEST_SEASON` — the app's
# default DATABASE_URL is production (the same DB the live league uses,
# see DEVELOPMENT.md), so if this ever collides with a real season, that
# season's real data gets silently wiped the moment any test runs.
# This happened for real: TEST_SEASON was 2024, the league's real 2024
# season had no data yet at the time, so the collision was invisible —
# until 2024 was backfilled with real data and the very next test run
# deleted all of it. A year like 1900 can't ever collide, by
# construction — don't "fix" this back to a real-looking year.
TEST_SEASON = 1900


@pytest_asyncio.fixture
async def pool():
    return await get_pool()


@pytest_asyncio.fixture(autouse=True)
async def cleanup_test_season(pool):
    yield
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM league_state WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM rosters WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM matchups WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM bench_crimes WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM weekly_team_stats WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM final_standings WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM season_champions WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM season_awards WHERE season = $1", TEST_SEASON)
        # rivalries.owner_a_id/owner_b_id -> owners.owner_id, so this has to
        # go before deleting owners below (no season column to scope by —
        # every test owner is 'test-%', so that's the only signal here).
        await conn.execute(
            "DELETE FROM rivalries WHERE owner_a_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%') "
            "OR owner_b_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        await conn.execute("DELETE FROM teams_by_season WHERE season = $1", TEST_SEASON)
        # owners.user_id -> users.id, so capture which users are linked to
        # test owners *before* deleting those owners, then delete the
        # users afterward — deleting users first would violate the FK.
        linked_user_ids = [
            r["user_id"]
            for r in await conn.fetch(
                "SELECT user_id FROM owners WHERE espn_member_id LIKE 'test-%' AND user_id IS NOT NULL"
            )
        ]
        await conn.execute("DELETE FROM owners WHERE espn_member_id LIKE 'test-%'")
        if linked_user_ids:
            await conn.execute("DELETE FROM users WHERE id = ANY($1::int[])", linked_user_ids)


@pytest.fixture
def espn_config(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    return ESPNConfig()
