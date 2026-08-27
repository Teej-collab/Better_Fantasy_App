import json

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import TEST_SEASON
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}


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
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"My Team {suffix}",
        )
    return owner_id, team_id


async def _ensure_roster_config(pool):
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", TEST_SEASON)
        if not exists:
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, $3)",
                TEST_SEASON, [], json.dumps(_ROSTER_SLOTS),
            )


async def _seed_player(pool, suffix, position="RB", draftable=True):
    sleeper_id = f"test-meteam-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', $5)
            """,
            sleeper_id, f"Test Player {suffix}", position, [position], draftable,
        )
    return sleeper_id


async def _seed_roster_entry(pool, team_id, sleeper_player_id, lineup_slot="BE", acquired_via="draft"):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, team_id, sleeper_player_id, lineup_slot, acquired_via,
        )


async def test_my_team_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/me/team")
    assert resp.status_code == 401


async def test_my_team_404s_without_a_team_this_season(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ('test-meteam-noteam', 'No Team') "
            "RETURNING owner_id"
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/team")
    assert resp.status_code == 404


async def test_my_team_returns_roster_from_current_rosters(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "roster1", espn_team_id=101)
    player = await _seed_player(pool, "roster1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    body = resp.json()
    assert body["team_name"] == "My Team roster1"
    assert body["roster"][0]["player_id"] == player
    assert body["roster"][0]["lineup_slot"] == "RB"


async def test_preview_move_reports_no_displacement_to_open_slot(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "move1", espn_team_id=102)
    player = await _seed_player(pool, "move1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-move", json={"sleeper_player_id": player, "to_slot": "RB"}
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["to_slot"] == "RB"
    assert body["displaced_player"] is None


async def test_preview_move_reports_displacement_when_slot_full(pool, monkeypatch):
    # QB has capacity 1 in _ROSTER_SLOTS — a clean single-occupant
    # displacement case, unlike RB (capacity 2), where a 3rd player
    # moving in would be genuinely ambiguous (which of 2 gets bumped).
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "move2", espn_team_id=103)
    bench_qb = await _seed_player(pool, "move2a", position="QB")
    starter_qb = await _seed_player(pool, "move2b", position="QB")
    await _seed_roster_entry(pool, team_id, bench_qb, lineup_slot="BE")
    await _seed_roster_entry(pool, team_id, starter_qb, lineup_slot="QB")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-move", json={"sleeper_player_id": bench_qb, "to_slot": "QB"}
        )

    assert resp.status_code == 200
    assert resp.json()["displaced_player"]["player_id"] == starter_qb


async def test_preview_move_rejects_ineligible_slot(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "move3", espn_team_id=104)
    wr_only = await _seed_player(pool, "move3", position="WR")
    await _seed_roster_entry(pool, team_id, wr_only, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-move", json={"sleeper_player_id": wr_only, "to_slot": "QB"}
        )

    assert resp.status_code == 400


async def test_preview_move_ambiguous_displacement_when_slot_has_multiple_occupants(pool, monkeypatch):
    # RB has capacity 2 — with both RB starter slots already filled, a
    # 3rd player moving in is genuinely ambiguous (which of 2 gets
    # bumped) rather than a clean single displacement.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "move3b", espn_team_id=113)
    bench_rb = await _seed_player(pool, "move3b_bench", position="RB")
    starter_rb1 = await _seed_player(pool, "move3b_s1", position="RB")
    starter_rb2 = await _seed_player(pool, "move3b_s2", position="RB")
    await _seed_roster_entry(pool, team_id, bench_rb, lineup_slot="BE")
    await _seed_roster_entry(pool, team_id, starter_rb1, lineup_slot="RB")
    await _seed_roster_entry(pool, team_id, starter_rb2, lineup_slot="RB")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-move", json={"sleeper_player_id": bench_rb, "to_slot": "RB"}
        )

    assert resp.status_code == 400


async def test_preview_swap(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "move4", espn_team_id=105)
    starter = await _seed_player(pool, "move4a", position="RB")
    bencher = await _seed_player(pool, "move4b", position="RB")
    await _seed_roster_entry(pool, team_id, starter, lineup_slot="RB")
    await _seed_roster_entry(pool, team_id, bencher, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-swap",
            json={"sleeper_player_id_a": starter, "sleeper_player_id_b": bencher},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["player_a"]["player_id"] == starter
    assert body["player_b"]["player_id"] == bencher


async def test_preview_move_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/me/team/lineup/preview-move", json={"sleeper_player_id": "x", "to_slot": "RB"})
    assert resp.status_code == 401


async def test_submit_move_updates_current_rosters(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "submit1", espn_team_id=106)
    player = await _seed_player(pool, "submit1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/lineup/move", json={"sleeper_player_id": player, "to_slot": "RB"})

    assert resp.status_code == 200
    roster = resp.json()["roster"]
    moved = next(r for r in roster if r["player_id"] == player)
    assert moved["lineup_slot"] == "RB"


async def test_submit_move_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/me/team/lineup/move", json={"sleeper_player_id": "x", "to_slot": "RB"})
    assert resp.status_code == 401


async def test_submit_swap_updates_both_players(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "submit2", espn_team_id=107)
    starter = await _seed_player(pool, "submit2a", position="RB")
    bencher = await _seed_player(pool, "submit2b", position="RB")
    await _seed_roster_entry(pool, team_id, starter, lineup_slot="RB")
    await _seed_roster_entry(pool, team_id, bencher, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/lineup/swap",
            json={"sleeper_player_id_a": starter, "sleeper_player_id_b": bencher},
        )

    assert resp.status_code == 200
    roster = {r["player_id"]: r["lineup_slot"] for r in resp.json()["roster"]}
    assert roster[starter] == "BE"
    assert roster[bencher] == "RB"


async def test_submit_swap_requires_session(pool):
    async with _client() as client:
        resp = await client.post(
            "/me/team/lineup/swap", json={"sleeper_player_id_a": "x", "sleeper_player_id_b": "y"}
        )
    assert resp.status_code == 401


async def test_drop_player_removes_them_from_the_roster(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "drop1", espn_team_id=111)
    player = await _seed_player(pool, "drop1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": player})

    assert resp.status_code == 200
    ids = {r["player_id"] for r in resp.json()["roster"]}
    assert player not in ids


async def test_drop_player_rejects_a_player_not_on_the_roster(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, _ = await _seed_owner_with_team(pool, "drop2", espn_team_id=112)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": "not-rostered"})

    assert resp.status_code == 404


async def test_drop_player_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": "x"})
    assert resp.status_code == 401


async def test_drop_player_only_ever_targets_the_callers_own_team(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_a, team_a = await _seed_owner_with_team(pool, "dropcross_a", espn_team_id=113)
    owner_b, _ = await _seed_owner_with_team(pool, "dropcross_b", espn_team_id=114)
    player_a = await _seed_player(pool, "dropcross_a", position="RB")
    await _seed_roster_entry(pool, team_a, player_a, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_b))
        resp = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": player_a})

    # owner_b doesn't have player_a on their roster at all.
    assert resp.status_code == 404


async def test_lineup_moves_only_ever_target_the_callers_own_team(pool, monkeypatch):
    """team_id is resolved server-side from the session's owner_id,
    never accepted from the request body — confirmed by seeding two
    owners with two different teams and checking a move against the
    caller's own roster only touches their own current_rosters row."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_a, team_a = await _seed_owner_with_team(pool, "cross_a", espn_team_id=108)
    owner_b, team_b = await _seed_owner_with_team(pool, "cross_b", espn_team_id=109)
    player_a = await _seed_player(pool, "cross_a", position="RB")
    await _seed_roster_entry(pool, team_a, player_a, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_b))
        resp = await client.post("/me/team/lineup/move", json={"sleeper_player_id": player_a, "to_slot": "RB"})

    # owner_b doesn't have player_a on their roster at all.
    assert resp.status_code == 404


async def test_new_free_agents_list_excludes_rostered_players(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "fa1", espn_team_id=110)
    rostered = await _seed_player(pool, "fa1_rostered", position="WR")
    available = await _seed_player(pool, "fa1_available", position="WR")
    await _seed_roster_entry(pool, team_id, rostered, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/me/team/free-agents", params={"position": "WR"})

    assert resp.status_code == 200
    ids = {p["sleeper_player_id"] for p in resp.json()["players"]}
    assert available in ids
    assert rostered not in ids


async def test_add_free_agent_real_write_with_open_spot(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "fa2", espn_team_id=111)
    player = await _seed_player(pool, "fa2", position="WR")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/free-agents/add", json={"sleeper_player_id": player})

    assert resp.status_code == 200
    body = resp.json()
    assert any(r["player_id"] == player for r in body["roster"])
    assert body["dropped_player"] is None


async def test_add_free_agent_rejects_already_rostered_player(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "fa3", espn_team_id=112)
    player = await _seed_player(pool, "fa3", position="WR")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/free-agents/add", json={"sleeper_player_id": player})

    assert resp.status_code == 400


async def test_add_free_agent_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/me/team/free-agents/add", json={"sleeper_player_id": "x"})
    assert resp.status_code == 401


async def _seed_tiny_roster_config(pool):
    # A 1-spot roster (just enough for one WR, no bench) — cheap way to
    # exercise the roster_full path without seeding a full 12-slot team.
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, $3)",
            TEST_SEASON, [], json.dumps({"WR": 1, "BE": 0}),
        )


async def test_add_free_agent_roster_full_without_drop_returns_roster_full(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _seed_tiny_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "fa4", espn_team_id=114)
    already_on_roster = await _seed_player(pool, "fa4_existing", position="WR")
    await _seed_roster_entry(pool, team_id, already_on_roster, lineup_slot="WR")
    new_player = await _seed_player(pool, "fa4_new", position="WR")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/me/team/free-agents/add", json={"sleeper_player_id": new_player})

    assert resp.status_code == 409
    assert resp.json()["error"] == "roster_full"


async def test_add_free_agent_roster_full_with_drop_succeeds(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _seed_tiny_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "fa5", espn_team_id=115)
    already_on_roster = await _seed_player(pool, "fa5_existing", position="WR")
    await _seed_roster_entry(pool, team_id, already_on_roster, lineup_slot="WR")
    new_player = await _seed_player(pool, "fa5_new", position="WR")

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/me/team/free-agents/add",
            json={"sleeper_player_id": new_player, "drop_sleeper_player_id": already_on_roster},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["dropped_player"]["player_id"] == already_on_roster
    assert any(r["player_id"] == new_player for r in body["roster"])
    assert not any(r["player_id"] == already_on_roster for r in body["roster"])
