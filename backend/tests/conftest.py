import pytest
import pytest_asyncio

from app.db import get_pool
from app.providers.espn.config import ESPNConfig

TEST_SEASON = 2024


@pytest_asyncio.fixture
async def pool():
    return await get_pool()


@pytest_asyncio.fixture(autouse=True)
async def cleanup_test_season(pool):
    yield
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM rosters WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM matchups WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM season_champions WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM teams_by_season WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM owners WHERE espn_member_id LIKE 'test-%'")


@pytest.fixture
def espn_config(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    return ESPNConfig()
