"""League formats (2026-10): creating a league of a given type, the
roster shape it starts from, and standings that rank on points."""
import json
import uuid

from httpx import ASGITransport, AsyncClient

from app.domain import league_format
from app.domain.draft_autopick import _position_capacity
from app.domain.roster_slots import is_eligible_for_slot
from app.main import app
from app.queries import league as league_queries
from app.queries import leagues as leagues_queries
from app.queries import teams as team_queries

TEST_SEASON = 1900  # matches conftest.TEST_SEASON


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _sign_up(client: AsyncClient, email: str):
    resp = await client.post("/auth/signup", json={"email": email, "password": "correct-horse", "display_name": "Format Tester"})
    assert resp.status_code == 200


# ---- pure ----------------------------------------------------------------


def test_superflex_takes_a_qb_and_any_flex_player():
    assert is_eligible_for_slot("QB", "QB/RB/WR/TE")
    assert is_eligible_for_slot("TE", "QB/RB/WR/TE")
    assert not is_eligible_for_slot("K", "QB/RB/WR/TE")
    assert not is_eligible_for_slot("QB", "RB/WR/TE")


def test_idp_slots_fold_raw_defensive_positions_into_groups():
    assert is_eligible_for_slot("DE", "DL")
    assert is_eligible_for_slot("OLB", "LB")
    assert is_eligible_for_slot("CB", "IDP")
    assert not is_eligible_for_slot("CB", "LB")


def test_autopick_counts_superflex_toward_qb_capacity():
    slots = league_format.PRESET_ROSTER_SLOTS["superflex"]
    standard = league_format.PRESET_ROSTER_SLOTS["standard"]
    assert _position_capacity("QB", slots) == _position_capacity("QB", standard) + 1
    assert _position_capacity("RB", slots) == _position_capacity("RB", standard) + 1


def test_type_settings_are_defaulted_and_clamped():
    assert league_format.normalize_type_settings("keeper", "snake", {"keepers_per_team": 99}) == {"keepers_per_team": 10}
    assert league_format.normalize_type_settings("dynasty", "snake", None) == {"rookie_draft_rounds": 4, "taxi_squad_size": 3}
    assert league_format.normalize_type_settings("redraft", "auction", {}) == {"auction_budget": 200}


def test_best_ball_roster_uses_its_bench_and_drops_ir():
    slots = league_format.roster_slots_for("standard", "bestball", {"bench_size": 12})
    assert slots["BE"] == 12 and slots["IR"] == 0


# ---- create a league -----------------------------------------------------


async def test_create_a_superflex_points_keeper_league(pool):
    async with _client() as client:
        await _sign_up(client, f"test-format-create-{uuid.uuid4().hex[:8]}@example.com")
        resp = await client.post(
            "/leagues",
            json={
                "name": "Test League Format Superflex",
                "league_type": "keeper",
                "matchup_type": "points",
                "roster_preset": "superflex",
                "type_settings": {"keepers_per_team": 3},
                "make_active": True,
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        me = (await client.get("/auth/me")).json()

    assert body["league_type"] == "keeper"
    assert body["matchup_type"] == "points"
    assert body["roster_preset"] == "superflex"
    assert body["type_settings"] == {"keepers_per_team": 3}
    assert me["league_format"]["roster_preset"] == "superflex"

    async with pool.acquire() as conn:
        season = await conn.fetchval("SELECT max(season) FROM league_keeper_rules WHERE league_id = $1", body["id"])
        keepers = await conn.fetchval("SELECT max_keepers FROM league_keeper_rules WHERE league_id = $1", body["id"])
        slots = await conn.fetchval(
            "SELECT roster_slots FROM league_roster_slots_settings WHERE league_id = $1 AND season = $2", body["id"], season
        )
    assert keepers == 3
    assert json.loads(slots)["QB/RB/WR/TE"] == 1


async def test_a_format_that_isnt_built_yet_cant_be_created(pool, monkeypatch):
    monkeypatch.setitem(league_format.AVAILABLE, "league_type", ("redraft", "keeper"))
    async with _client() as client:
        await _sign_up(client, f"test-format-blocked-{uuid.uuid4().hex[:8]}@example.com")
        resp = await client.post("/leagues", json={"name": "Test League Format Blocked", "league_type": "dynasty"})
        formats = (await client.get("/leagues/formats")).json()
    assert resp.status_code == 422
    assert {"key": "dynasty", "available": False} in formats["league_type"]


async def test_every_league_format_is_open(pool):
    async with _client() as client:
        formats = (await client.get("/leagues/formats")).json()
    for field in ("league_type", "matchup_type", "draft_type", "roster_preset"):
        assert all(option["available"] for option in formats[field]), field


async def test_an_older_client_still_gets_a_standard_league(pool):
    async with _client() as client:
        await _sign_up(client, f"test-format-old-{uuid.uuid4().hex[:8]}@example.com")
        resp = await client.post("/leagues", json={"name": "Test League Format Old Client", "keepers": False})
    body = resp.json()
    assert (body["league_type"], body["matchup_type"], body["draft_type"], body["roster_preset"]) == (
        "redraft", "h2h", "snake", "standard",
    )


# ---- standings -----------------------------------------------------------


async def _league_with_results(pool, matchup_type: str) -> int:
    """Two teams: A wins two close weeks, B wins one blowout.
    A: 2-1 with 300 points; B: 1-2 with 330."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name, token_version) VALUES ($1, 'x', 'F', 1) RETURNING id",
            f"test-format-standings-{uuid.uuid4().hex[:8]}@example.com",
        )
        league_id = await leagues_queries.create_league(conn, f"Test League Standings {matchup_type}", user_id, uuid.uuid4().hex[:10])
        await conn.execute("UPDATE leagues SET matchup_type = $2 WHERE id = $1", league_id, matchup_type)
        team_ids = []
        for name in ("A", "B"):
            owner_id = await team_queries.get_or_create_owner_for_user(conn, user_id, f"Owner {name}") if name == "A" else (
                await conn.fetchval(
                    "INSERT INTO owners (display_name, espn_member_id) VALUES ($1, $2) RETURNING owner_id",
                    f"Owner {name}", f"test-format-{uuid.uuid4().hex[:8]}",
                )
            )
            team_ids.append(await team_queries.create_team(conn, league_id, TEST_SEASON, owner_id, f"Team {name}"))
        a, b = [t["team_id"] for t in team_ids]
        for week, (sa, sb) in enumerate([(100, 90), (100, 90), (100, 150)], start=1):
            await conn.execute(
                """INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id)
                   VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)""",
                TEST_SEASON, week, a, b, sa, sb, league_id,
            )
    return league_id


async def test_total_points_standings_rank_on_points(pool):
    h2h = await _league_with_results(pool, "h2h")
    points = await _league_with_results(pool, "points")
    async with pool.acquire() as conn:
        h2h_rows = await league_queries.get_standings(conn, TEST_SEASON, h2h)
        points_rows = await league_queries.get_standings(conn, TEST_SEASON, points)
    assert [r["team_name"] for r in h2h_rows] == ["Team A", "Team B"]
    assert [r["team_name"] for r in points_rows] == ["Team B", "Team A"]


async def test_commissioner_changes_format_until_the_draft_is_set_up(pool):
    async with _client() as client:
        await _sign_up(client, f"test-format-patch-{uuid.uuid4().hex[:8]}@example.com")
        league = (await client.post("/leagues", json={"name": "Test League Format Patch"})).json()
        changed = await client.patch(f"/leagues/{league['id']}/format", json={"roster_preset": "2qb", "matchup_type": "points"})
        assert changed.status_code == 200, changed.text
        assert changed.json()["roster_preset"] == "2qb"

        async with pool.acquire() as conn:
            season = await conn.fetchval(
                "SELECT season FROM league_roster_slots_settings WHERE league_id = $1", league["id"]
            )
            slots = json.loads(await conn.fetchval(
                "SELECT roster_slots FROM league_roster_slots_settings WHERE league_id = $1", league["id"]
            ))
            assert slots["QB"] == 2
            await conn.execute(
                "INSERT INTO draft_config (season, league_id, draft_order, roster_slots) VALUES ($1, $2, '{}', $3)",
                season, league["id"], json.dumps(slots),
            )
        try:
            locked = await client.patch(f"/leagues/{league['id']}/format", json={"roster_preset": "standard"})
            matchups = await client.patch(f"/leagues/{league['id']}/format", json={"matchup_type": "h2h"})
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM draft_config WHERE league_id = $1", league["id"])
    assert locked.status_code == 409, locked.text
    assert matchups.status_code == 200 and matchups.json()["matchup_type"] == "h2h"


# ---- the scoring editor (2026-10) -----------------------------------------------


async def test_scoring_editor_adds_catalog_stats_and_lists_them(pool):
    async with _client() as client:
        await _sign_up(client, f"test-format-scoring-{uuid.uuid4().hex[:8]}@example.com")
        league = (await client.post("/leagues", json={"name": "Test League Scoring Editor", "make_active": True})).json()
        catalog = (await client.get("/league/scoring-catalog")).json()
        saved = await client.put(
            "/league/scoring-rules", json={"season": catalog["season"], "rules": {"k_tackle": 5, "not_a_stat": 3}}
        )
        after = (await client.get("/league/scoring-catalog")).json()
        request = await client.post("/league/scoring-requests", json={"message": "first downs"})

    assert saved.status_code == 200
    by_key = {s["key"]: s for s in after["stats"]}
    assert by_key["k_tackle"]["value"] == 5
    assert "not_a_stat" not in by_key
    assert by_key["two_pt_pass"]["tracked"] is False
    assert {g["key"] for g in catalog["groups"]} >= {"passing", "kicking", "bonuses"}
    assert request.status_code == 200
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM feedback WHERE message LIKE $1", f"%league {league['id']}]%")


async def test_custom_league_request_lands_in_the_feedback_inbox(pool):
    async with _client() as client:
        await _sign_up(client, f"test-format-custom-{uuid.uuid4().hex[:8]}@example.com")
        resp = await client.post("/leagues/custom-request", json={"message": "Test custom: 3-QB, two divisions"})
        empty = await client.post("/leagues/custom-request", json={"message": "   "})
        providers = (await client.get("/auth/providers")).json()
    assert resp.status_code == 200
    assert empty.status_code in (400, 422)
    assert set(providers) == {"google"}
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            "SELECT id FROM feedback WHERE message = '[Custom league request] Test custom: 3-QB, two divisions'"
        )
        await conn.execute("DELETE FROM feedback WHERE id = $1", row)
    assert row is not None
