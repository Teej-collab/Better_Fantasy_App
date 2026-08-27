from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import TEST_SEASON
from tests.fakes_espn import FakeLeague


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_espn_env(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))


def _patch_league(monkeypatch, league):
    monkeypatch.setattr("app.providers.espn.free_agents.League", lambda **kwargs: league)


async def test_waiver_settings_reflects_real_league_config(monkeypatch):
    _set_espn_env(monkeypatch)
    _patch_league(monkeypatch, FakeLeague(faab=False, acquisition_budget=100))

    async with _client() as client:
        resp = await client.get("/free-agents/waiver-settings")

    assert resp.status_code == 200
    assert resp.json() == {"uses_faab": False, "acquisition_budget": 100}
