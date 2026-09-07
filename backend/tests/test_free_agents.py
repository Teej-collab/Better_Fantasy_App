from httpx import ASGITransport, AsyncClient

from app.main import app
from app.providers.espn import free_agents
from app.providers.espn.config import ESPNConfig
from tests.conftest import TEST_SEASON
from tests.fakes_espn import FakeLeague, make_fake_player_card_player


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


def _set_espn_env_direct(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")


def test_get_projections_matches_known_espn_ids_directly(monkeypatch):
    _set_espn_env_direct(monkeypatch)
    mahomes = make_fake_player_card_player(4242335, projected_total_points=290.97, projected_avg_points=17.12)
    _patch_league(monkeypatch, FakeLeague(player_info_by_id={4242335: mahomes}))

    result = free_agents.get_projections([4242335], [], config=ESPNConfig(), season=TEST_SEASON)

    assert result["by_espn_id"][4242335]["projected_points"] == 290.97
    assert result["resolved_ids_by_name"] == {}


def test_get_projections_resolves_dst_by_team_nickname(monkeypatch):
    """Sleeper stores a D/ST's full_name as the real team's full name
    ("Houston Texans") — ESPN indexes the same unit as "Texans D/ST"
    under a negative id. Confirmed live 2026-09: this silently left
    every one of the league's 32 real defenses with no projection."""
    _set_espn_env_direct(monkeypatch)
    texans_dst = make_fake_player_card_player(-16034, projected_total_points=129.06, projected_avg_points=7.59)
    _patch_league(
        monkeypatch,
        FakeLeague(player_info_by_id={-16034: texans_dst}, player_map={"Texans D/ST": -16034}),
    )

    result = free_agents.get_projections([], ["Houston Texans"], config=ESPNConfig(), season=TEST_SEASON)

    assert result["resolved_ids_by_name"] == {"Houston Texans": -16034}
    assert result["by_espn_id"][-16034]["projected_points"] == 129.06


def test_get_projections_resolves_suffixed_active_players(monkeypatch):
    """A real gap confirmed live 2026-09: active starters like Anthony
    Richardson never matched because ESPN carries a "Sr."/"Jr." suffix
    Sleeper's own full_name omits."""
    _set_espn_env_direct(monkeypatch)
    richardson = make_fake_player_card_player(4432577, projected_total_points=250.0, projected_avg_points=14.7)
    _patch_league(
        monkeypatch,
        FakeLeague(
            player_info_by_id={4432577: richardson}, player_map={"Anthony Richardson Sr.": 4432577}
        ),
    )

    result = free_agents.get_projections([], ["Anthony Richardson"], config=ESPNConfig(), season=TEST_SEASON)

    assert result["resolved_ids_by_name"] == {"Anthony Richardson": 4432577}
    assert result["by_espn_id"][4432577]["projected_points"] == 250.0


def test_get_projections_leaves_a_genuinely_unmatched_name_unresolved(monkeypatch):
    _set_espn_env_direct(monkeypatch)
    _patch_league(monkeypatch, FakeLeague(player_map={"Someone Else": 999}))

    result = free_agents.get_projections([], ["Totally Unknown Guy"], config=ESPNConfig(), season=TEST_SEASON)

    assert result["resolved_ids_by_name"] == {}
    assert result["by_espn_id"] == {}
