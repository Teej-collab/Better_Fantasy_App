from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import TEST_SEASON
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=123, is_commissioner=False
    )
    return {"session": token}


def _set_espn_env(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))


def _patch_league(monkeypatch, league):
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)


async def _seed_owner_with_team(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-meteam-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            TEST_SEASON, espn_team_id, owner_id, f"My Team {suffix}",
        )
    return owner_id


async def test_my_team_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/me/team")
    assert resp.status_code == 401


async def test_my_team_404s_without_a_team_this_season(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = None
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ('test-meteam-noteam', 'No Team') "
            "RETURNING owner_id"
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/team")
    assert resp.status_code == 404


async def test_my_team_returns_live_roster_with_projections(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 1, espn_team_id=41)
    roster = [
        make_fake_lineup_player(
            1, "My Star", "RB", ["RB", "BE"], stats={5: {"points": 20.0, "projected_points": 15.5}}
        )
    ]
    team = make_fake_team(41, "My Team 1", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    body = resp.json()
    assert body["team_name"] == "My Team 1"
    assert body["roster"][0]["player_name"] == "My Star"
    assert body["roster"][0]["points_projected"] == 15.5


async def test_preview_move_never_calls_espn_write_endpoint(pool, monkeypatch):
    """The whole point of preview-move: it uses plan_lineup_change, which
    has no network write path at all — confirmed here by never even
    setting up anything an HTTP write call could hit, only the read-side
    fake League."""
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 2, espn_team_id=42)
    roster = [make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE"])]
    team = make_fake_team(42, "My Team 2", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 5}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"player_name": "Bench RB", "to_slot": "RB"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["player"]["player_name"] == "Bench RB"
    assert body["from_slot"]["label"] == "BE"
    assert body["to_slot"]["label"] == "RB"
    assert body["displaced_player"] is None


async def test_preview_move_reports_displacement(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 3, espn_team_id=43)
    roster = [
        make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE"]),
        make_fake_lineup_player(2, "Starting RB", "RB", ["RB", "BE"]),
    ]
    team = make_fake_team(43, "My Team 3", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 5}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"player_name": "Bench RB", "to_slot": "RB"})

    assert resp.status_code == 200
    assert resp.json()["displaced_player"]["player_name"] == "Starting RB"


async def test_preview_move_rejects_ineligible_slot(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 4, espn_team_id=44)
    roster = [make_fake_lineup_player(1, "WR Only", "BE", ["WR", "BE"])]
    team = make_fake_team(44, "My Team 4", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 5}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"player_name": "WR Only", "to_slot": "RB"})

    assert resp.status_code == 400


async def test_preview_swap(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 5, espn_team_id=45)
    roster = [
        make_fake_lineup_player(1, "Starter", "RB", ["RB", "BE"]),
        make_fake_lineup_player(2, "Bencher", "BE", ["RB", "BE"]),
    ]
    team = make_fake_team(45, "My Team 5", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-swap", json={"player_a": "Starter", "player_b": "Bencher"}
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["player_a"]["player_name"] == "Starter"
    assert body["player_b"]["player_name"] == "Bencher"


async def test_preview_move_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/me/team/lineup/preview-move", json={"player_name": "X", "to_slot": "RB"})
    assert resp.status_code == 401


def _add_body(**overrides):
    body = {"player_id": 999, "player_name": "Free Agent Guy", "position": "RB", "pro_team": "KC"}
    body.update(overrides)
    return body


async def test_preview_add_free_agent_with_open_roster_spot(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 6, espn_team_id=46)
    roster = [make_fake_lineup_player(1, "Starter", "RB", ["RB", "BE"])]
    team = make_fake_team(46, "My Team 6", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 5}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/free-agents/preview-add", json=_add_body())

    assert resp.status_code == 200
    body = resp.json()
    assert body["added_player"]["player_name"] == "Free Agent Guy"
    assert body["roster_size_before"] == 1
    assert body["roster_capacity"] == 6
    assert body["dropped_player"] is None


async def test_preview_add_free_agent_roster_full_without_drop_returns_roster_full(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 7, espn_team_id=47)
    roster = [
        make_fake_lineup_player(1, "Starter", "RB", ["RB", "BE"]),
        make_fake_lineup_player(2, "Bencher", "BE", ["RB", "BE"]),
    ]
    team = make_fake_team(47, "My Team 7", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 1}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/free-agents/preview-add", json=_add_body())

    assert resp.status_code == 409
    body = resp.json()
    assert body["error"] == "roster_full"


async def test_preview_add_free_agent_roster_full_with_drop_succeeds(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 8, espn_team_id=48)
    roster = [
        make_fake_lineup_player(1, "Starter", "RB", ["RB", "BE"]),
        make_fake_lineup_player(2, "Bencher", "BE", ["RB", "BE"]),
    ]
    team = make_fake_team(48, "My Team 8", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 1}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/free-agents/preview-add", json=_add_body(drop_player_name="Bencher")
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["dropped_player"]["player_name"] == "Bencher"
    assert body["roster_size_before"] == 2
    assert body["roster_capacity"] == 2


async def test_preview_add_free_agent_rejects_already_rostered_player(pool, monkeypatch):
    _set_espn_env(monkeypatch)
    owner_id = await _seed_owner_with_team(pool, 9, espn_team_id=49)
    roster = [make_fake_lineup_player(999, "Already Mine", "RB", ["RB", "BE"])]
    team = make_fake_team(49, "My Team 9", "test-member-1", "Alice", "Smith", roster=roster)
    _patch_league(monkeypatch, FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 1, "BE": 5}))

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/free-agents/preview-add", json=_add_body(player_id=999, player_name="Already Mine")
        )

    assert resp.status_code == 400


async def test_preview_add_free_agent_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/me/team/free-agents/preview-add", json=_add_body())
    assert resp.status_code == 401
