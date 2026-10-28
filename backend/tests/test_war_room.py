"""Tests for app/domain/war_room.py and app/routers/war_room.py."""
import datetime

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.domain import war_room
from app.domain.war_room import chance_available, hindsight_grades
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def test_chance_a_player_is_still_there():
    assert chance_available(30, 20, 5) > 0.9  # goes ten picks later
    assert chance_available(10, 30, 15) < 0.05  # long gone
    assert 0.4 < chance_available(25, 25, 10) < 0.6
    assert chance_available(5, 40, 0) == 1.0  # nobody picks before you


def test_hindsight_grades_rank_by_what_the_picks_scored():
    grades = hindsight_grades({1: 900, 2: 600, 3: 300, 4: 100})
    assert [grades[o]["rank"] for o in (1, 2, 3, 4)] == [1, 2, 3, 4]
    assert grades[1]["letter"] != grades[4]["letter"]


async def _member(pool, i):
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-warroom-{i}@example.com", f"User {i}",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-warroom-owner-{i}", f"Manager {i}",
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) "
            "RETURNING id",
            TEST_SEASON, 960000 + i, owner_id, f"Team {i}",
        )
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=200000 + owner_id, is_commissioner=False
    )
    return owner_id, team_id, {"session": token}


def _client(cookies):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", cookies=cookies)


async def test_keeper_season_hides_who_others_kept_until_lock_and_nudges_once_a_day(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    sent = []

    async def fake_send(conn, owner_id, payload, now=None):
        sent.append(owner_id)
        return 1

    monkeypatch.setattr("app.notifications.dispatcher.send_to_owner", fake_send)

    async def push_on(conn, owner_id):
        return {"push_enabled": True}

    monkeypatch.setattr("app.routers.war_room.preferences_queries.get_preferences", push_on)
    me, _, cookies = await _member(pool, 1)
    other, _, _ = await _member(pool, 2)
    deadline = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_keeper_rules (season, league_id, max_keepers, max_consecutive_years, keeper_deadline) "
            "VALUES ($1, 1, 2, 2, $2)",
            TEST_SEASON, deadline,
        )
        for owner, pid, name in ((me, 1, "Mine One"), (me, 2, "Mine Two"), (other, 3, "Secret Pick")):
            await conn.execute(
                "INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name, league_id) "
                "VALUES ($1, $2, $3, $4, 1)",
                TEST_SEASON, owner, pid, name,
            )

    async with _client(cookies) as client:
        body = (await client.get("/war-room")).json()
        assert body["phase"] == "keepers"
        managers = {m["owner_id"]: m for m in body["keepers"]["managers"]}
        assert managers[me]["players"] == ["Mine One", "Mine Two"] and managers[me]["done"]
        assert managers[other]["count"] == 1 and managers[other]["players"] is None
        assert body["keepers"]["waiting_on"] >= 1

        first = await client.post("/war-room/keeper-nudge")
        assert first.status_code == 200 and other in sent and me not in sent
        assert (await client.post("/war-room/keeper-nudge")).status_code == 429

    async with pool.acquire() as conn:
        await conn.execute("UPDATE league_keeper_rules SET locked_at = now() WHERE season = $1", TEST_SEASON)
        keepers = await war_room.keepers_phase(conn, TEST_SEASON, 1, me)
    assert {m["owner_id"]: m["players"] for m in keepers["managers"]}[other] == ["Secret Pick"]


async def test_report_card_after_the_draft(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    me, my_team, cookies = await _member(pool, 3)
    other, _, _ = await _member(pool, 4)
    async with pool.acquire() as conn:
        for pid, pos in (("test-wr-a", "WR"), ("test-wr-b", "WR"), ("test-rb-c", "RB"), ("test-rb-d", "RB")):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position) VALUES ($1, $1, $2) "
                "ON CONFLICT (sleeper_player_id) DO NOTHING",
                pid, pos,
            )
        await conn.execute(
            "INSERT INTO draft_config (season, league_id, draft_type, draft_order, roster_slots, status) "
            "VALUES ($1, 1, 'snake', $2, '{}'::jsonb, 'complete')",
            TEST_SEASON, [me, other],
        )
        # Me: 1.01 a flop, 2.02 a late hit. Other: two steady picks.
        picks = [
            (1, 1, 1, me, "test-wr-a"), (2, 1, 2, other, "test-rb-c"),
            (3, 2, 1, other, "test-rb-d"), (4, 2, 2, me, "test-wr-b"),
        ]
        for number, rnd, rp, owner, pid in picks:
            await conn.execute(
                "INSERT INTO draft_picks (season, league_id, pick_number, round, round_pick, owner_id, sleeper_player_id) "
                "VALUES ($1, 1, $2, $3, $4, $5, $6)",
                TEST_SEASON, number, rnd, rp, owner, pid,
            )
        for pid, pts in (("test-wr-a", 10), ("test-wr-b", 120), ("test-rb-c", 80), ("test-rb-d", 60)):
            await conn.execute(
                "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, league_id) "
                "VALUES ($1, 3, $2, '{}', $3, 1)",
                TEST_SEASON, pid, pts,
            )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, league_id) "
            "VALUES ($1, $2, 'test-wr-b', 'WR', 1)",
            TEST_SEASON, my_team,
        )

    async with _client(cookies) as client:
        body = (await client.get("/war-room")).json()
    assert body["phase"] == "report_card"
    card = body["report_card"]
    assert card["through_week"] == 3
    assert card["hindsight"]["rank"] == 2  # my picks scored 130, theirs 140
    assert [(p["player_name"], p["status"], p["points"]) for p in card["picks"]] == [
        ("test-wr-a", "gone", 10.0), ("test-wr-b", "starter", 120.0),
    ]
    assert card["best_pick"]["player_name"] == "test-wr-b"
    assert card["biggest_miss"]["player_name"] == "test-wr-a"


async def test_queue_shows_each_players_chance_who_took_him_and_open_spots(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    me, _, cookies = await _member(pool, 5)
    other, _, _ = await _member(pool, 6)

    async def board(conn, season, league_id, snapshot_id):
        return {"test-q-b": 2.0, "test-q-c": 30.0, "test-q-d": 3.0}

    monkeypatch.setattr(war_room, "_adp_board", board)
    async with pool.acquire() as conn:
        for pid, pos in (("test-q-a", "RB"), ("test-q-b", "WR"), ("test-q-c", "TE"), ("test-q-d", "QB")):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position) VALUES ($1, $1, $2) ON CONFLICT DO NOTHING", pid, pos,
            )
        await conn.execute(
            "INSERT INTO draft_config (season, league_id, draft_type, draft_order, roster_slots, status, current_pick_number) "
            "VALUES ($1, 1, 'snake', $2, $3::jsonb, 'in_progress', 3)",
            TEST_SEASON, [me, other], '{"QB": 1, "RB": 2, "WR": 2, "TE": 1, "BE": 2}',
        )
        for number, rnd, rp, owner, pid in ((1, 1, 1, me, "test-q-a"), (2, 1, 2, other, "test-q-b"), (3, 2, 1, other, None), (4, 2, 2, me, None)):
            await conn.execute(
                "INSERT INTO draft_picks (season, league_id, pick_number, round, round_pick, owner_id, sleeper_player_id) "
                "VALUES ($1, 1, $2, $3, $4, $5, $6)",
                TEST_SEASON, number, rnd, rp, owner, pid,
            )
        for rank, pid in enumerate(("test-q-b", "test-q-c", "test-q-d"), start=1):
            await conn.execute(
                "INSERT INTO draft_queue_items (season, league_id, owner_id, sleeper_player_id, rank) VALUES ($1, 1, $2, $3, $4)",
                TEST_SEASON, me, pid, rank,
            )

    async with _client(cookies) as client:
        draft = (await client.get("/war-room")).json()["draft"]
    assert draft["next_pick_label"] == "2.02"
    assert draft["picks_until"] == 1
    gone, late, early = draft["queue_full"]
    assert gone["taken_by"] == {"name": "Manager 6", "pick": "1.02"} and gone["chance"] is None
    assert late["chance"] > 0.9  # ADP 30, going at pick 4
    assert early["chance"] < 0.5  # ADP 3, one pick ahead of you
    assert [q["sleeper_player_id"] for q in draft["queue"]] == ["test-q-c", "test-q-d"]
    assert draft["needs"] == [{"position": "QB", "count": 1}, {"position": "RB", "count": 1}, {"position": "WR", "count": 2}, {"position": "TE", "count": 1}]


async def test_keeper_outlook_keeps_the_early_ones_and_lets_late_ones_go(pool, monkeypatch):
    me, _, _ = await _member(pool, 7)
    for i in range(8, 18):
        await _member(pool, i)

    async def board(conn, season, league_id, snapshot_id):
        return {"test-k-early": 2.0, "test-k-late": 70.0}

    monkeypatch.setattr(war_room, "_adp_board", board)
    async with pool.acquire() as conn:
        out = await war_room.keeper_outlook(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, me, ["test-k-early", "test-k-late", "test-k-none"])
    assert out["test-k-early"]["tone"] == "keep"
    assert out["test-k-late"]["tone"] == "let_go"
    assert "middle pick" in out["test-k-late"]["verdict"]  # no draft order yet
    assert out["test-k-none"]["verdict"] is None and out["test-k-none"]["adp"] is None


async def test_dynasty_section_ages_taxi_and_rookie_picks(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ('test-warroom-dyn@example.com', 'x', 'Dyn') RETURNING id"
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ('test-warroom-owner-dyn', 'Dyn') RETURNING owner_id"
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        league_id = await league_queries.create_league(conn, "Test League Dynasty War Room", user_id, "WARDYN01")
        await conn.execute(
            "UPDATE leagues SET league_type = 'dynasty', type_settings = '{\"rookie_draft_rounds\": 3, \"taxi_squad_size\": 2}'::jsonb WHERE id = $1",
            league_id,
        )
        await league_queries.add_member(conn, league_id, user_id, "commissioner")
        await league_queries.set_active_league_id(conn, user_id, league_id)
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) VALUES ($1, 961001, $2, 'Dyn', $3) RETURNING id",
            TEST_SEASON, owner_id, league_id,
        )
        for pid, pos, age, slot in (("test-d-qb", "QB", 31, "QB"), ("test-d-wr", "WR", 23, "WR"), ("test-d-rook", "RB", 21, "TAXI")):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, age, years_exp) VALUES ($1, $1, $2, $3, 0) ON CONFLICT DO NOTHING",
                pid, pos, age,
            )
            await conn.execute(
                "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, league_id) VALUES ($1, $2, $3, $4, $5)",
                TEST_SEASON, team_id, pid, slot, league_id,
            )
    token = create_session_token(_SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=209999, is_commissioner=False)
    async with _client({"session": token}) as client:
        dynasty = (await client.get("/war-room")).json()["dynasty"]
    assert dynasty["avg_starter_age"] == 27.0
    assert dynasty["starters_29_plus"] == 1
    assert dynasty["taxi"]["size"] == 2
    assert [p["sleeper_player_id"] for p in dynasty["taxi"]["players"]] == ["test-d-rook"]
    assert dynasty["rookie_draft"]["rounds"] == 3 and dynasty["rookie_draft"]["projected"] is True
    assert {"position": "QB", "young": 0, "prime": 0, "old": 1} in dynasty["ages"]


async def test_mock_board_lists_players_by_adp_and_the_league_shape(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    me, _, cookies = await _member(pool, 30)

    async def board(conn, season, league_id, snapshot_id):
        return {"test-m-b": 2.0, "test-m-a": 1.0}

    monkeypatch.setattr(war_room, "_adp_board", board)
    async with pool.acquire() as conn:
        for pid, pos in (("test-m-a", "RB"), ("test-m-b", "WR")):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position) VALUES ($1, $1, $2) ON CONFLICT DO NOTHING", pid, pos,
            )
    async with _client(cookies) as client:
        body = (await client.get("/war-room/mock")).json()
    assert [p["id"] for p in body["players"]] == ["test-m-a", "test-m-b"]
    assert body["uses_adp"] is True and body["rounds"] > 0 and body["teams"] >= 1
