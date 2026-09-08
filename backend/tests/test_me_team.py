import json
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import TEST_SEASON, make_safe_session_user_id
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}
_ROSTER_SLOTS_WITH_IR = {**_ROSTER_SLOTS, "IR": 1}


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id(pool), owner_id=owner_id, discord_user_id=123, is_commissioner=False
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


async def _ensure_roster_config(pool, roster_slots=None):
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", TEST_SEASON)
        if not exists:
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, $3)",
                TEST_SEASON, [], json.dumps(roster_slots or _ROSTER_SLOTS),
            )


async def _seed_player(pool, suffix, position="RB", draftable=True, espn_player_id=None, injury_status=None, pro_team="KC"):
    sleeper_id = f"test-meteam-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable, injury_status)
            VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8)
            """,
            sleeper_id, espn_player_id, f"Test Player {suffix}", position, [position], pro_team, draftable, injury_status,
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")
    assert resp.status_code == 404


async def test_my_team_returns_roster_from_current_rosters(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "roster1", espn_team_id=101)
    player = await _seed_player(pool, "roster1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    body = resp.json()
    assert body["team_name"] == "My Team roster1"
    assert body["roster"][0]["player_id"] == player
    assert body["roster"][0]["lineup_slot"] == "RB"
    # No league_state row seeded for this season — current week isn't
    # resolvable, so the score/schedule fields degrade to null rather
    # than erroring.
    assert body["roster"][0]["points"] is None
    assert body["roster"][0]["next_opponent"] is None
    assert body["roster"][0]["game_time"] is None
    assert body["roster"][0]["bye_week"] is None
    assert body["roster"][0]["on_offense"] is False
    assert body["roster"][0]["is_redzone"] is False


async def test_my_team_includes_bye_week_when_synced(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "bye1", espn_team_id=117)
    player = await _seed_player(pool, "bye1", position="RB")  # pro_team always 'KC'
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO team_bye_weeks (season, pro_team, bye_week) VALUES ($1, 'KC', 9)", TEST_SEASON
        )

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    assert resp.json()["roster"][0]["bye_week"] == 9


async def test_my_team_includes_live_offense_and_redzone_status(pool, monkeypatch):
    from app.gamecast import service as gamecast_service
    from app.gamecast.models import GameStatus, LiveGame, TeamRef
    from datetime import datetime, timezone

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "live1", espn_team_id=118)
    player = await _seed_player(pool, "live1", position="RB")  # pro_team always 'KC'
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")

    fake_game = LiveGame(
        game_id="test-live-1",
        provider="test",
        status=GameStatus.IN_PROGRESS,
        season=TEST_SEASON,
        week=1,
        scheduled_start=datetime.now(timezone.utc),
        home_team=TeamRef(abbr="KC", name="Kansas City Chiefs"),
        away_team=TeamRef(abbr="LV", name="Las Vegas Raiders"),
        possession_team_abbr="KC",
        is_redzone=True,
        last_updated=datetime.now(timezone.utc),
    )

    def fake_all_cached_states():
        return [fake_game]

    monkeypatch.setattr(gamecast_service, "all_cached_states", fake_all_cached_states)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["on_offense"] is True
    assert entry["is_redzone"] is True


async def test_my_team_ownership_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/me/team/ownership")
    assert resp.status_code == 401


async def test_my_team_ownership_only_covers_players_with_a_resolved_espn_id(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "own1", espn_team_id=119)
    resolved = await _seed_player(pool, "own1_resolved", position="RB", espn_player_id=555)
    unresolved = await _seed_player(pool, "own1_unresolved", position="WR")  # no espn_player_id
    await _seed_roster_entry(pool, team_id, resolved, lineup_slot="RB")
    await _seed_roster_entry(pool, team_id, unresolved, lineup_slot="BE")

    def fake_get_bulk_ownership(espn_player_ids, season=None):
        assert espn_player_ids == [555]  # only the resolved id was ever asked for
        return {555: {"percent_owned": 87.3, "percent_started": 61.0}}

    monkeypatch.setattr("app.routers.me.get_bulk_ownership", fake_get_bulk_ownership)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team/ownership")

    assert resp.status_code == 200
    body = resp.json()["ownership"]
    assert body[resolved]["percent_owned"] == 87.3
    assert unresolved not in body


async def test_my_team_ownership_empty_with_no_crosswalk_at_all(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "own2", espn_team_id=120)
    player = await _seed_player(pool, "own2", position="RB")  # no espn_player_id
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("get_bulk_ownership should never be called with zero resolved ids")

    monkeypatch.setattr("app.routers.me.get_bulk_ownership", fail_if_called)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team/ownership")

    assert resp.status_code == 200
    assert resp.json() == {"ownership": {}}


async def test_my_team_includes_this_weeks_score_when_computed(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "score1", espn_team_id=115)
    player = await _seed_player(pool, "score1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 3, $2, '{}', 14.5)",
            TEST_SEASON, player,
        )

    async def _empty_scoreboard(week, year, season_type=None):
        return []

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _empty_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["points"] == 14.5
    # No scoreboard game matched this player's pro_team (empty fake
    # scoreboard) — schedule fields still degrade gracefully.
    assert entry["next_opponent"] is None


async def test_my_team_includes_projected_points(pool, monkeypatch):
    """A real 2026-09 gap: the My Team roster view never showed a
    projection at all, so an owner setting their lineup couldn't see
    projected points anywhere on the page."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "proj1", espn_team_id=116)
    player = await _seed_player(pool, "proj1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 3) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        await conn.execute(
            "UPDATE players SET projected_avg_points = 12.3 WHERE sleeper_player_id = $1", player
        )

    async def _empty_scoreboard(week, year, season_type=None):
        return []

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _empty_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["points_projected"] == 12.3


async def test_my_team_includes_next_opponent_and_game_time_from_scoreboard(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "sched1", espn_team_id=116)
    player = await _seed_player(pool, "sched1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON
        )

    async def _fake_scoreboard(week, year, season_type=None):
        return [{"home_team": "KC", "away_team": "SF", "date": "2026-09-21T20:00Z", "state": "pre"}]

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _fake_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")

    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    # _seed_player always sets pro_team='KC' — the home team in the fake game.
    assert entry["next_opponent"] == "vs SF"
    assert entry["game_time"] == "2026-09-21T20:00Z"


async def test_preview_move_reports_no_displacement_to_open_slot(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "move1", espn_team_id=102)
    player = await _seed_player(pool, "move1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-move", json={"sleeper_player_id": wr_only, "to_slot": "QB"}
        )

    assert resp.status_code == 400


async def test_preview_move_to_ir_allowed_for_injured_player(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool, roster_slots=_ROSTER_SLOTS_WITH_IR)
    owner_id, team_id = await _seed_owner_with_team(pool, "ir1", espn_team_id=114)
    hurt = await _seed_player(pool, "ir1", position="RB", injury_status="Out")
    await _seed_roster_entry(pool, team_id, hurt, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"sleeper_player_id": hurt, "to_slot": "IR"})

    assert resp.status_code == 200


async def test_preview_move_to_ir_rejected_for_healthy_player(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool, roster_slots=_ROSTER_SLOTS_WITH_IR)
    owner_id, team_id = await _seed_owner_with_team(pool, "ir2", espn_team_id=115)
    healthy = await _seed_player(pool, "ir2", position="RB", injury_status=None)
    await _seed_roster_entry(pool, team_id, healthy, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"sleeper_player_id": healthy, "to_slot": "IR"})

    assert resp.status_code == 400


async def test_preview_move_to_ir_rejected_for_merely_questionable_player(pool, monkeypatch):
    # Questionable/Doubtful players are still expected to potentially
    # play — only a real "out for a while" designation earns IR.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool, roster_slots=_ROSTER_SLOTS_WITH_IR)
    owner_id, team_id = await _seed_owner_with_team(pool, "ir3", espn_team_id=116)
    questionable = await _seed_player(pool, "ir3", position="RB", injury_status="Questionable")
    await _seed_roster_entry(pool, team_id, questionable, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-move", json={"sleeper_player_id": questionable, "to_slot": "IR"}
        )

    assert resp.status_code == 400


async def test_submit_move_to_ir_and_back_updates_current_rosters(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool, roster_slots=_ROSTER_SLOTS_WITH_IR)
    owner_id, team_id = await _seed_owner_with_team(pool, "ir4", espn_team_id=117)
    hurt = await _seed_player(pool, "ir4", position="RB", injury_status="IR")
    await _seed_roster_entry(pool, team_id, hurt, lineup_slot="BE")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/me/team/lineup/move", json={"sleeper_player_id": hurt, "to_slot": "IR"})

    assert resp.status_code == 200
    roster = resp.json()["roster"]
    moved = next(r for r in roster if r["player_id"] == hurt)
    assert moved["lineup_slot"] == "IR"


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
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-swap",
            json={"sleeper_player_id_a": starter, "sleeper_player_id_b": bencher},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["player_a"]["player_id"] == starter
    assert body["player_b"]["player_id"] == bencher


def _scoreboard_with_kickoff(pro_team: str, kickoff: datetime):
    async def _fake(week, year, season_type=None):
        return [{"home_team": pro_team, "away_team": "OPP", "date": kickoff.isoformat().replace("+00:00", "Z")}]

    return _fake


async def test_preview_move_rejected_once_players_game_has_started(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "lock1", espn_team_id=118)
    player = await _seed_player(pool, "lock1", position="RB", pro_team="KC")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON)
    kickoff = datetime.now(timezone.utc) - timedelta(hours=1)
    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _scoreboard_with_kickoff("KC", kickoff))

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"sleeper_player_id": player, "to_slot": "RB"})

    assert resp.status_code == 409


async def test_preview_move_allowed_before_players_game_has_started(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "lock2", espn_team_id=119)
    player = await _seed_player(pool, "lock2", position="RB", pro_team="KC")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="BE")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON)
    kickoff = datetime.now(timezone.utc) + timedelta(hours=1)
    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _scoreboard_with_kickoff("KC", kickoff))

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/me/team/lineup/preview-move", json={"sleeper_player_id": player, "to_slot": "RB"})

    assert resp.status_code == 200


async def test_preview_swap_rejected_when_a_player_is_locked(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "lock3", espn_team_id=120)
    starter = await _seed_player(pool, "lock3a", position="RB", pro_team="KC")
    bencher = await _seed_player(pool, "lock3b", position="RB", pro_team="KC")
    await _seed_roster_entry(pool, team_id, starter, lineup_slot="RB")
    await _seed_roster_entry(pool, team_id, bencher, lineup_slot="BE")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON)
    kickoff = datetime.now(timezone.utc) - timedelta(hours=1)
    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _scoreboard_with_kickoff("KC", kickoff))

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/me/team/lineup/preview-swap",
            json={"sleeper_player_id_a": starter, "sleeper_player_id_b": bencher},
        )

    assert resp.status_code == 409


async def test_submit_move_rejected_when_the_displaced_starter_is_locked(pool, monkeypatch):
    # The mover (FA, not on KC) isn't locked, but bumping the current KC
    # starter to the bench would touch a player whose game already
    # started — that has to be blocked too, not just moving the locked
    # player directly.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "lock4", espn_team_id=121)
    # QB has capacity 1 in _ROSTER_SLOTS — guarantees a real displacement
    # rather than the mover just filling a second open QB spot.
    locked_starter = await _seed_player(pool, "lock4a", position="QB", pro_team="KC")
    healthy_bencher = await _seed_player(pool, "lock4b", position="QB", pro_team="BUF")
    await _seed_roster_entry(pool, team_id, locked_starter, lineup_slot="QB")
    await _seed_roster_entry(pool, team_id, healthy_bencher, lineup_slot="BE")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 3)", TEST_SEASON)

    async def _fake_scoreboard(week, year, season_type=None):
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        return [{"home_team": "KC", "away_team": "OPP", "date": past}]

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _fake_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/me/team/lineup/move", json={"sleeper_player_id": healthy_bencher, "to_slot": "QB"}
        )

    assert resp.status_code == 409


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
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": player})

    assert resp.status_code == 200
    ids = {r["player_id"] for r in resp.json()["roster"]}
    assert player not in ids


async def test_drop_player_rejects_a_player_not_on_the_roster(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, _ = await _seed_owner_with_team(pool, "drop2", espn_team_id=112)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_b))
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
        client.cookies.update(await _session_cookie(pool, owner_b))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team/free-agents", params={"position": "WR"})

    assert resp.status_code == 200
    ids = {p["sleeper_player_id"] for p in resp.json()["players"]}
    assert available in ids
    assert rostered not in ids


async def test_free_agents_list_includes_projected_points_and_this_weeks_score(pool, monkeypatch):
    from app.routers import me as me_router

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async def _fake_scoreboard(week, year):
        return []

    monkeypatch.setattr(me_router, "get_week_scoreboard", _fake_scoreboard)
    owner_id, _ = await _seed_owner_with_team(pool, "fa-proj", espn_team_id=111)
    low = await _seed_player(pool, "fa-proj-low", position="WR")
    high = await _seed_player(pool, "fa-proj-high", position="WR")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 1) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        await conn.execute("UPDATE players SET projected_avg_points = 5.0 WHERE sleeper_player_id = $1", low)
        await conn.execute("UPDATE players SET projected_avg_points = 20.0 WHERE sleeper_player_id = $1", high)
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, $2, '{}', 18.5)",
            TEST_SEASON, high,
        )

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team/free-agents", params={"position": "WR"})
        await pool.execute("DELETE FROM league_state WHERE season = $1", TEST_SEASON)

    assert resp.status_code == 200
    by_id = {p["sleeper_player_id"]: p for p in resp.json()["players"]}
    assert float(by_id[high]["projected_points"]) == 20.0
    assert float(by_id[high]["score"]) == 18.5
    assert by_id[low]["score"] is None
    # Sorted by projected points descending — the higher-projected
    # player should come first.
    ids_in_order = [p["sleeper_player_id"] for p in resp.json()["players"] if p["sleeper_player_id"] in (low, high)]
    assert ids_in_order == [high, low]


async def test_add_free_agent_real_write_with_open_spot(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _ensure_roster_config(pool)
    owner_id, team_id = await _seed_owner_with_team(pool, "fa2", espn_team_id=111)
    player = await _seed_player(pool, "fa2", position="WR")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
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
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/me/team/free-agents/add",
            json={"sleeper_player_id": new_player, "drop_sleeper_player_id": already_on_roster},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["dropped_player"]["player_id"] == already_on_roster
    assert any(r["player_id"] == new_player for r in body["roster"])
    assert not any(r["player_id"] == already_on_roster for r in body["roster"])


async def test_my_team_current_week_is_editable(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "wk1", espn_team_id=120)
    player = await _seed_player(pool, "wk1", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )

    async def _empty_scoreboard(week, year, season_type=None):
        return []

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _empty_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team")
        resp_explicit = await client.get("/me/team?week=2")

    for r in (resp, resp_explicit):
        body = r.json()
        assert body["week"] == 2
        assert body["current_week"] == 2
        assert body["is_editable"] is True


async def test_my_team_past_week_is_read_only_and_uses_frozen_roster(pool, monkeypatch):
    """A past week must show that week's real, frozen roster_history
    snapshot — not today's live current_rosters — and must never be
    editable, since lineup_engine's mutation endpoints have no week
    concept and would silently apply to the wrong week."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "wk2", espn_team_id=121)
    week1_player = await _seed_player(pool, "wk2_week1", position="RB")
    await _seed_roster_entry(pool, team_id, week1_player, lineup_slot="RB")

    from app.queries.roster_history import snapshot_week

    async with pool.acquire() as conn:
        await snapshot_week(conn, TEST_SEASON, 1)
        # A real roster change after week 1's snapshot was taken — a
        # past week's view must not reflect this.
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )
        week2_player = await _seed_player(pool, "wk2_week2", position="WR")
        await _seed_roster_entry(pool, team_id, week2_player, lineup_slot="WR")
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )

    async def _empty_scoreboard(week, year, season_type=None):
        return []

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _empty_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team?week=1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["week"] == 1
    assert body["current_week"] == 2
    assert body["is_editable"] is False
    player_ids = {r["player_id"] for r in body["roster"]}
    assert player_ids == {week1_player}


async def test_my_team_past_week_shows_frozen_real_weekly_projection(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id, team_id = await _seed_owner_with_team(pool, "wk3", espn_team_id=122)
    player = await _seed_player(pool, "wk3", position="RB")
    await _seed_roster_entry(pool, team_id, player, lineup_slot="RB")

    from app.queries.roster_history import snapshot_week

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE players SET projected_avg_points = 10.0 WHERE sleeper_player_id = $1", player
        )
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
            "VALUES ($1, 1, $2, 24.5)",
            TEST_SEASON, player,
        )
        await snapshot_week(conn, TEST_SEASON, 1)
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )

    async def _empty_scoreboard(week, year, season_type=None):
        return []

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", _empty_scoreboard)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.get("/me/team?week=1")

    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["points_projected"] == 24.5
