"""Commissioner-only force-edit of a member's roster
(app/routers/commissioner_lineup.py) — same current_rosters domain
logic app/domain/lineup_engine.py already has real coverage for
(test_me_team.py), so these tests focus on what's actually new here:
commissioner gating and the explicit team_id/league_id resolution,
not re-testing lineup_engine's own move/add/drop mechanics."""
import json
import itertools
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON, make_safe_session_user_id

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_ROSTER_SLOTS = {"QB": 1, "RB": 1, "WR": 1, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 1}
_espn_team_ids = itertools.count(920000)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_env(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))


async def _seed_owner_with_team(pool, suffix, is_commissioner=False, league_id=DEFAULT_LEAGUE_ID):
    user_id = await make_safe_session_user_id(pool)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-commlineup-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            TEST_SEASON, next(_espn_team_ids), owner_id, f"Team {suffix}", league_id,
        )
        role = "commissioner" if is_commissioner else "member"
        await conn.execute(
            "INSERT INTO league_members (league_id, user_id, role) VALUES ($1, $2, $3)",
            league_id, user_id, role,
        )
    token = create_session_token(_SESSION_SECRET, user_id=user_id, owner_id=owner_id)
    return {"user_id": user_id, "owner_id": owner_id, "team_id": team_id, "cookies": {"session": token}}


async def _ensure_roster_config(pool, league_id=DEFAULT_LEAGUE_ID):
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM draft_config WHERE season = $1 AND league_id = $2", TEST_SEASON, league_id
        )
        if not exists:
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots, league_id) VALUES ($1, $2, $3, $4)",
                TEST_SEASON, [], json.dumps(_ROSTER_SLOTS), league_id,
            )


async def _seed_player(pool, suffix, position="RB"):
    sleeper_id = f"test-commlineup-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
            "VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE)",
            sleeper_id, f"Test Player {suffix}", position, [position],
        )
    return sleeper_id


async def _seed_roster_entry(pool, team_id, sleeper_player_id, lineup_slot="BE"):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, $4, 'draft')",
            TEST_SEASON, team_id, sleeper_player_id, lineup_slot,
        )


async def test_drop_requires_session():
    async with _client() as client:
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/1/roster/drop", json={"sleeper_player_id": "x"}
        )
    assert resp.status_code == 401


async def test_drop_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "drop_noncomm_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "drop_noncomm_target")
    non_commish = await _seed_owner_with_team(pool, "drop_noncomm_member")
    player = await _seed_player(pool, "dropreq")
    await _seed_roster_entry(pool, target["team_id"], player)

    async with _client() as client:
        client.cookies.update(non_commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/drop",
            json={"sleeper_player_id": player},
        )
    assert resp.status_code == 403


async def test_get_roster_returns_current_rosters_not_the_weekly_snapshot(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "getroster_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "getroster_target")
    player = await _seed_player(pool, "getroster")
    await _seed_roster_entry(pool, target["team_id"], player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.get(f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster")

    assert resp.status_code == 200
    assert any(p["player_id"] == player for p in resp.json()["roster"])


async def test_commissioner_can_drop_a_player_from_another_members_roster(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "drop_ok_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "drop_ok_target")
    player = await _seed_player(pool, "dropok")
    await _seed_roster_entry(pool, target["team_id"], player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/drop",
            json={"sleeper_player_id": player},
        )
    assert resp.status_code == 200
    assert all(p["player_id"] != player for p in resp.json()["roster"])


async def test_drop_404s_for_a_team_not_in_the_callers_league(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "drop_wrongleague_commish", is_commissioner=True)
    async with pool.acquire() as conn:
        other_league_id = await league_queries.create_league(
            conn, "Test League Commlineup Other", commish["user_id"], "commlineup-other-code"
        )
    await _ensure_roster_config(pool, league_id=other_league_id)
    other_league_target = await _seed_owner_with_team(pool, "drop_wrongleague_target", league_id=other_league_id)
    player = await _seed_player(pool, "dropwrongleague")
    await _seed_roster_entry(pool, other_league_target["team_id"], player)

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{other_league_target['team_id']}/roster/drop",
            json={"sleeper_player_id": player},
        )
    assert resp.status_code == 404


async def test_commissioner_can_add_a_free_agent_to_another_members_roster(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "add_ok_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "add_ok_target")
    free_agent = await _seed_player(pool, "addok", position="WR")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/add",
            json={"sleeper_player_id": free_agent},
        )
    assert resp.status_code == 200
    assert any(p["player_id"] == free_agent for p in resp.json()["roster"])


async def test_add_reports_roster_full_without_a_drop_target(pool, monkeypatch):
    _set_env(monkeypatch)
    # BE=1, RB=1 in _ROSTER_SLOTS — fill both starter and bench RB slots
    # so the roster is genuinely full before the add attempt.
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "add_full_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "add_full_target")
    starter = await _seed_player(pool, "addfull_starter", position="RB")
    bench = await _seed_player(pool, "addfull_bench", position="RB")
    await _seed_roster_entry(pool, target["team_id"], starter, lineup_slot="RB")
    await _seed_roster_entry(pool, target["team_id"], bench, lineup_slot="BE")
    # Fill every other required starter slot too, so total roster size hits capacity.
    for suffix, position, slot in [
        ("qb", "QB", "QB"), ("wr", "WR", "WR"), ("te", "TE", "TE"),
        ("flex", "RB", "RB/WR/TE"), ("dst", "DEF", "D/ST"), ("k", "K", "K"),
    ]:
        p = await _seed_player(pool, f"addfull_{suffix}", position=position)
        await _seed_roster_entry(pool, target["team_id"], p, lineup_slot=slot)
    free_agent = await _seed_player(pool, "addfull_newcomer", position="WR")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/add",
            json={"sleeper_player_id": free_agent},
        )
    assert resp.status_code == 409
    assert resp.json()["error"] == "roster_full"


def _scoreboard_with_kickoff(pro_team: str, kickoff: datetime):
    async def _fake(week, year, season_type=None):
        return [{"home_team": pro_team, "away_team": "OPP", "date": kickoff.isoformat().replace("+00:00", "Z")}]

    return _fake


async def test_commissioner_add_rejected_once_players_game_has_started(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "add_locked_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "add_locked_target")
    free_agent = await _seed_player(pool, "add_locked", position="WR")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON)
    kickoff = datetime.now(timezone.utc) - timedelta(hours=1)
    monkeypatch.setattr("app.routers.commissioner_lineup.get_week_scoreboard", _scoreboard_with_kickoff("KC", kickoff))

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/add",
            json={"sleeper_player_id": free_agent},
        )
    assert resp.status_code == 409
    assert resp.json()["error"] == "on_waivers"


async def test_commissioner_add_override_waivers_bypasses_the_kickoff_lock(pool, monkeypatch):
    # override_waivers is the commissioner's explicit "bypass waivers
    # outright" escape hatch (see CommissionerRosterAddRequest's own
    # docstring) — it must still work on a player who was never
    # actually dropped, just whose game already started.
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "add_override_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "add_override_target")
    free_agent = await _seed_player(pool, "add_override", position="WR")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON)
    kickoff = datetime.now(timezone.utc) - timedelta(hours=1)
    monkeypatch.setattr("app.routers.commissioner_lineup.get_week_scoreboard", _scoreboard_with_kickoff("KC", kickoff))

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/add",
            json={"sleeper_player_id": free_agent, "override_waivers": True},
        )
    assert resp.status_code == 200
    assert any(p["player_id"] == free_agent for p in resp.json()["roster"])


async def test_move_requires_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    target = await _seed_owner_with_team(pool, "move_noncomm_target")
    non_commish = await _seed_owner_with_team(pool, "move_noncomm_member")
    player = await _seed_player(pool, "movereq")
    await _seed_roster_entry(pool, target["team_id"], player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(non_commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/move",
            json={"sleeper_player_id": player, "to_slot": "RB"},
        )
    assert resp.status_code == 403


async def test_commissioner_can_move_a_player_into_an_empty_flex(pool, monkeypatch):
    # The real report this endpoint exists for: a team with no FLEX
    # starter set — a commissioner needs to be able to put a real
    # RB/WR/TE into that empty slot directly, without the self-serve
    # lock (kickoff) blocking it.
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "move_ok_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "move_ok_target")
    player = await _seed_player(pool, "moveok", position="RB")
    await _seed_roster_entry(pool, target["team_id"], player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/move",
            json={"sleeper_player_id": player, "to_slot": "RB/WR/TE"},
        )
    assert resp.status_code == 200
    moved = next(p for p in resp.json()["roster"] if p["player_id"] == player)
    assert moved["lineup_slot"] == "RB/WR/TE"


async def test_move_rejects_a_slot_the_player_isnt_eligible_for(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "move_bad_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "move_bad_target")
    kicker = await _seed_player(pool, "movebad", position="K")
    await _seed_roster_entry(pool, target["team_id"], kicker, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/move",
            json={"sleeper_player_id": kicker, "to_slot": "QB"},
        )
    assert resp.status_code == 400


async def test_commissioner_can_swap_two_players_slots(pool, monkeypatch):
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    commish = await _seed_owner_with_team(pool, "swap_ok_commish", is_commissioner=True)
    target = await _seed_owner_with_team(pool, "swap_ok_target")
    starter = await _seed_player(pool, "swapok_starter", position="RB")
    flex = await _seed_player(pool, "swapok_flex", position="RB")
    await _seed_roster_entry(pool, target["team_id"], starter, lineup_slot="RB")
    await _seed_roster_entry(pool, target["team_id"], flex, lineup_slot="RB/WR/TE")

    async with _client() as client:
        client.cookies.update(commish["cookies"])
        resp = await client.post(
            f"/leagues/{DEFAULT_LEAGUE_ID}/teams/{target['team_id']}/roster/swap",
            json={"sleeper_player_id_a": starter, "sleeper_player_id_b": flex},
        )
    assert resp.status_code == 200
    roster = {p["player_id"]: p["lineup_slot"] for p in resp.json()["roster"]}
    assert roster[starter] == "RB/WR/TE"
    assert roster[flex] == "RB"
