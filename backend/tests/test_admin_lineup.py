from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _commissioner_cookie():
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=1, discord_user_id=900001, is_commissioner=True
    )
    return {"session": token}


async def _request(method, path, cookies=None, json=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.request(method, path, json=json)


def _set_espn_env(monkeypatch, dry_run=None):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", "2026")
    if dry_run is not None:
        monkeypatch.setenv("ESPN_DRY_RUN", "true" if dry_run else "false")


def _patch_league(monkeypatch, league):
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)


async def test_roster_endpoint_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _request("GET", "/admin/lineup/teams/1/roster")
    assert response.status_code == 401


async def test_roster_endpoint_rejects_non_commissioner(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    non_commissioner = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=1, discord_user_id=900001, is_commissioner=False
    )
    response = await _request("GET", "/admin/lineup/teams/1/roster", cookies={"session": non_commissioner})
    assert response.status_code == 403


async def test_roster_endpoint_returns_live_roster_with_resolved_labels(monkeypatch):
    _set_espn_env(monkeypatch)
    bench_player = make_fake_lineup_player(1, "Bench Guy", "BE", ["RB", "BE", "IR"])
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=[bench_player])
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5))

    response = await _request("GET", "/admin/lineup/teams/4/roster", cookies=_commissioner_cookie())
    assert response.status_code == 200
    roster = response.json()["roster"]
    assert roster[0]["player_name"] == "Bench Guy"
    assert roster[0]["lineup_slot_label"] == "BE"
    assert {"id": 2, "label": "RB"} in roster[0]["eligible_slots"]


async def test_roster_endpoint_team_not_found_maps_to_404(monkeypatch):
    _set_espn_env(monkeypatch)
    _patch_league(monkeypatch, FakeLeague(teams=[], current_week=5))

    response = await _request("GET", "/admin/lineup/teams/999/roster", cookies=_commissioner_cookie())
    assert response.status_code == 404


async def test_set_lineup_dry_run_by_default(monkeypatch):
    _set_espn_env(monkeypatch)  # ESPN_DRY_RUN unset -> defaults true
    roster = [make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE"])]
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5))

    response = await _request(
        "POST",
        "/admin/lineup/teams/4/set",
        cookies=_commissioner_cookie(),
        json={"player_name": "Bench RB", "to_slot": "RB"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert body["attempted"] is False


async def test_set_lineup_player_not_found_maps_to_404(monkeypatch):
    _set_espn_env(monkeypatch)
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=[])
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5))

    response = await _request(
        "POST",
        "/admin/lineup/teams/4/set",
        cookies=_commissioner_cookie(),
        json={"player_name": "Nobody", "to_slot": "RB"},
    )
    assert response.status_code == 404


async def test_swap_dry_run_by_default(monkeypatch):
    _set_espn_env(monkeypatch)
    roster = [
        make_fake_lineup_player(1, "Starter", "RB", ["RB", "BE"]),
        make_fake_lineup_player(2, "Bencher", "BE", ["RB", "BE"]),
    ]
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5))

    response = await _request(
        "POST",
        "/admin/lineup/teams/4/swap",
        cookies=_commissioner_cookie(),
        json={"player_a": "Starter", "player_b": "Bencher"},
    )
    assert response.status_code == 200
    assert response.json()["dry_run"] is True
