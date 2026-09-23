import datetime
import itertools
import json

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from tests.conftest import TEST_SEASON, make_safe_session_user_id

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_ROSTER_SLOTS = {"QB": 1, "RB": 1, "WR": 1, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 1}
_espn_team_ids = itertools.count(910000)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_env(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))


async def _seed_owner_with_team(pool, suffix, is_commissioner=False):
    """A real user<->owner<->team linkage — trades authorization checks
    (app/domain/trades.py's _team_is_controlled_by_user) resolve
    identity through owner_users, unlike /me/team's own owner_id-JWT-
    claim shortcut, so this has to be a real link, not the decoupled
    convenience test_me_team.py's helpers use."""
    user_id = await make_safe_session_user_id(pool)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-trades-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) "
            "VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, next(_espn_team_ids), owner_id, f"Team {suffix}",
        )
        role = "commissioner" if is_commissioner else "member"
        await conn.execute(
            "INSERT INTO league_members (league_id, user_id, role) VALUES ($1, $2, $3)",
            DEFAULT_LEAGUE_ID, user_id, role,
        )
    token = create_session_token(_SESSION_SECRET, user_id=user_id, owner_id=owner_id)
    return {"user_id": user_id, "owner_id": owner_id, "team_id": team_id, "cookies": {"session": token}}


async def _ensure_roster_config(pool):
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", TEST_SEASON)
        if not exists:
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, $3)",
                TEST_SEASON, [], json.dumps(_ROSTER_SLOTS),
            )


async def _seed_player(pool, suffix, position="RB"):
    sleeper_id = f"test-trades-player-{suffix}"
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


async def _setup_two_teams(pool, suffix, a_commissioner=False, b_commissioner=False):
    await _ensure_roster_config(pool)
    a = await _seed_owner_with_team(pool, f"{suffix}a", is_commissioner=a_commissioner)
    b = await _seed_owner_with_team(pool, f"{suffix}b", is_commissioner=b_commissioner)
    give_player = await _seed_player(pool, f"{suffix}-give")
    receive_player = await _seed_player(pool, f"{suffix}-receive")
    await _seed_roster_entry(pool, a["team_id"], give_player)
    await _seed_roster_entry(pool, b["team_id"], receive_player)
    return a, b, give_player, receive_player


async def test_propose_trade_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/trades", json={"receiving_team_id": 1, "give": ["x"], "receive": ["y"]})
    assert resp.status_code == 401


async def test_propose_trade_succeeds_and_shows_in_both_teams_mine(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "propose")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        assert resp.status_code == 200, resp.text
        trade = resp.json()
        assert trade["status"] == "pending"
        assert trade["proposing_team_id"] == a["team_id"]
        assert trade["receiving_team_id"] == b["team_id"]

        mine_a = await client.get("/trades/mine")
        assert any(t["id"] == trade["id"] for t in mine_a.json()["trades"])

        client.cookies.update(b["cookies"])
        mine_b = await client.get("/trades/mine")
        assert any(t["id"] == trade["id"] for t in mine_b.json()["trades"])


async def test_propose_trade_rejects_player_not_on_giving_roster(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "notowned")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [receive_player], "receive": [receive_player]}
        )
    assert resp.status_code == 400


async def test_propose_trade_rejects_empty_side(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "empty")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.post("/trades", json={"receiving_team_id": b["team_id"], "give": [], "receive": [receive_player]})
    assert resp.status_code == 400


async def test_propose_trade_blocked_after_deadline(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "deadline")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        past = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
        settings_resp = await client.put("/trades/settings", json={"season": TEST_SEASON, "trade_deadline": past, "review_required": False})
        assert settings_resp.status_code == 403  # not a commissioner yet

    # Re-seed as commissioner to actually set the deadline.
    c = await _seed_owner_with_team(pool, "deadline-commish", is_commissioner=True)
    async with _client() as client:
        client.cookies.update(c["cookies"])
        past = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
        settings_resp = await client.put(
            "/trades/settings", json={"season": TEST_SEASON, "trade_deadline": past, "review_required": False}
        )
        assert settings_resp.status_code == 200, settings_resp.text

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
    assert resp.status_code == 400
    assert "deadline" in resp.json()["detail"].lower()


async def test_accept_trade_applies_roster_swap_when_review_not_required(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "accept")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        client.cookies.update(b["cookies"])
        accept_resp = await client.post(f"/trades/{trade_id}/accept")
        assert accept_resp.status_code == 200, accept_resp.text
        assert accept_resp.json()["status"] == "accepted"

    async with pool.acquire() as conn:
        a_has_receive = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], receive_player,
        )
        b_has_give = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, b["team_id"], give_player,
        )
        a_still_has_give = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], give_player,
        )
    assert a_has_receive
    assert b_has_give
    assert not a_still_has_give


async def test_accept_trade_only_receiving_owner_can_respond(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "notyours")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        # proposer tries to accept their own proposal
        accept_resp = await client.post(f"/trades/{trade_id}/accept")
    assert accept_resp.status_code == 403


async def test_accept_trade_succeeds_for_a_co_owner_not_just_the_original_owner(pool, monkeypatch):
    """2026-09-22 real fix: a second real user linked to the same
    owner_id via a co-owner invite must be able to respond to a trade
    exactly like the original owner — this is the one authorization
    check (_team_is_controlled_by_user) that used to compare a single
    owners.user_id value, so only one of the two linked accounts could
    ever pass it."""
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "coowner")

    co_owner_user_id = await make_safe_session_user_id(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", b["owner_id"], co_owner_user_id
        )
    co_owner_token = create_session_token(_SESSION_SECRET, user_id=co_owner_user_id, owner_id=b["owner_id"])

    async with _client() as client:
        client.cookies.update(a["cookies"])
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        client.cookies.update({"session": co_owner_token})
        accept_resp = await client.post(f"/trades/{trade_id}/accept")
    assert accept_resp.status_code == 200, accept_resp.text


async def test_reject_trade_leaves_rosters_untouched(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "reject")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        client.cookies.update(b["cookies"])
        reject_resp = await client.post(f"/trades/{trade_id}/reject")
        assert reject_resp.status_code == 200
        assert reject_resp.json()["status"] == "rejected"

    async with pool.acquire() as conn:
        a_still_has_give = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], give_player,
        )
    assert a_still_has_give


async def test_cancel_trade_only_proposer_and_only_while_pending(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "cancel")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        client.cookies.update(b["cookies"])
        not_yours_resp = await client.post(f"/trades/{trade_id}/cancel")
        assert not_yours_resp.status_code == 403

        client.cookies.update(a["cookies"])
        cancel_resp = await client.post(f"/trades/{trade_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

        already_cancelled_resp = await client.post(f"/trades/{trade_id}/cancel")
        assert already_cancelled_resp.status_code == 409


async def test_trade_awaits_commissioner_review_when_required(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "review", a_commissioner=True)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        settings_resp = await client.put(
            "/trades/settings", json={"season": TEST_SEASON, "trade_deadline": None, "review_required": True}
        )
        assert settings_resp.status_code == 200

        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        client.cookies.update(b["cookies"])
        accept_resp = await client.post(f"/trades/{trade_id}/accept")
        assert accept_resp.status_code == 200
        assert accept_resp.json()["status"] == "awaiting_review"

    async with pool.acquire() as conn:
        a_still_has_give = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], give_player,
        )
    assert a_still_has_give  # not applied yet

    async with _client() as client:
        client.cookies.update(b["cookies"])
        not_commissioner_resp = await client.post(f"/trades/{trade_id}/review", json={"approve": True})
        assert not_commissioner_resp.status_code == 403

        client.cookies.update(a["cookies"])
        approve_resp = await client.post(f"/trades/{trade_id}/review", json={"approve": True})
        assert approve_resp.status_code == 200
        assert approve_resp.json()["status"] == "accepted"

    async with pool.acquire() as conn:
        a_has_receive = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], receive_player,
        )
    assert a_has_receive  # applied now


async def test_commissioner_can_veto_an_awaiting_review_trade(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "veto", a_commissioner=True)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        await client.put("/trades/settings", json={"season": TEST_SEASON, "trade_deadline": None, "review_required": True})
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

        client.cookies.update(b["cookies"])
        await client.post(f"/trades/{trade_id}/accept")

        client.cookies.update(a["cookies"])
        veto_resp = await client.post(f"/trades/{trade_id}/review", json={"approve": False})
        assert veto_resp.status_code == 200
        assert veto_resp.json()["status"] == "vetoed"

    async with pool.acquire() as conn:
        a_still_has_give = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], give_player,
        )
    assert a_still_has_give  # never applied


async def test_accept_revalidates_asset_still_owned(pool, monkeypatch):
    """A trade proposed, then one asset gets traded away out-of-band
    before the receiving owner responds — accept must re-check
    ownership, not just trust the original proposal."""
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "revalidate")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        propose_resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )
        trade_id = propose_resp.json()["id"]

    # a drops the give_player out of band (simulating some other roster move).
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, a["team_id"], give_player,
        )

    async with _client() as client:
        client.cookies.update(b["cookies"])
        accept_resp = await client.post(f"/trades/{trade_id}/accept")
    assert accept_resp.status_code == 400


async def test_accept_revalidates_roster_capacity(pool, monkeypatch):
    """The receiving team is at capacity and would receive more
    players than it gives up — accept must reject, not overfill the
    roster."""
    _set_env(monkeypatch)
    await _ensure_roster_config(pool)
    a = await _seed_owner_with_team(pool, "capacity-a")
    b = await _seed_owner_with_team(pool, "capacity-b")
    give_a = await _seed_player(pool, "capacity-give-a")
    give_b1 = await _seed_player(pool, "capacity-give-b1")
    give_b2 = await _seed_player(pool, "capacity-give-b2")
    await _seed_roster_entry(pool, a["team_id"], give_a)
    await _seed_roster_entry(pool, b["team_id"], give_b1)
    await _seed_roster_entry(pool, b["team_id"], give_b2)
    # _ROSTER_SLOTS above totals 8 slots; fill team A up to capacity so
    # receiving 2 players for 1 given pushes it over.
    filler_players = [await _seed_player(pool, f"capacity-filler-{i}") for i in range(7)]
    for p in filler_players:
        await _seed_roster_entry(pool, a["team_id"], p)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_a], "receive": [give_b1, give_b2]}
        )
    assert resp.status_code == 400
    assert "capacity" in resp.json()["detail"].lower()
