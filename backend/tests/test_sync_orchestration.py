from httpx import ASGITransport, AsyncClient

from app.main import app
from app.providers.espn.adapter import ESPNProvider
from app.providers.sync import run_full_sync, run_live_sync
from tests.conftest import TEST_SEASON
from tests.fakes_espn import FakeLeague, make_fake_team


async def _get(path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def _cleanup_league_state(pool, season):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM league_state WHERE season = $1", season)


async def test_current_week_endpoint_null_when_nothing_cached(pool):
    resp = await _get(f"/seasons/{TEST_SEASON}/current-week")
    assert resp.status_code == 200
    assert resp.json() == {"season": TEST_SEASON, "current_week": None}


async def test_run_live_sync_caches_current_week(pool, espn_config, monkeypatch):
    fake_teams = [make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith")]
    fake_league = FakeLeague(teams=fake_teams, scoreboard_by_week={}, box_scores_by_week={})
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    # matchups/rosters will fail for week 9 (no fake data configured) —
    # that's fine, the point of this test is that league_state still gets
    # cached regardless (best-effort, doesn't depend on those succeeding).
    await run_live_sync(provider, TEST_SEASON, 9)

    resp = await _get(f"/seasons/{TEST_SEASON}/current-week")
    assert resp.json() == {"season": TEST_SEASON, "current_week": 9}

    await _cleanup_league_state(pool, TEST_SEASON)


async def test_run_full_sync_caches_current_week_for_end_season(pool, espn_config, monkeypatch):
    fake_teams = [make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith")]
    fake_league = FakeLeague(teams=fake_teams, current_week=4)
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    await run_full_sync(provider, TEST_SEASON, TEST_SEASON)

    resp = await _get(f"/seasons/{TEST_SEASON}/current-week")
    assert resp.json() == {"season": TEST_SEASON, "current_week": 4}

    await _cleanup_league_state(pool, TEST_SEASON)
