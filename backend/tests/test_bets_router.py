"""Bet tracking routes (app/routers/bets.py): private by default,
graded live, settled at the final, shareable to league chat."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.routers import bets as bets_router
from tests.conftest import make_safe_session_user_id, make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_EVENT = "test-event-401"
_SLEEPER_ID = "test-bets-gibbs"
_ESPN_ID = 990001


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _cookie(user_id: int, owner_id: int | None = None):
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=None, is_commissioner=False)}


@pytest.fixture
def game_state(monkeypatch):
    """A fake this-week slate and a box score the test can move along."""
    state = {"scoreline": {"state": "in", "home_team": "DET", "away_team": "GB", "home_score": 14, "away_score": 10},
             "prop_stats": {_ESPN_ID: {"player_name": "Jahmyr Gibbs", "pro_team": "DET", "stats": {"rush_yd": 64}}},
             "final": False}

    async def scoreboard():
        return [{"id": _EVENT, "home_team": "DET", "away_team": "GB"}]

    async def game_stats(event_id):
        assert event_id == _EVENT
        return state

    monkeypatch.setattr(bets_router, "get_nfl_scoreboard", scoreboard)
    monkeypatch.setattr(bets_router, "get_game_stats", game_stats)
    return state


@pytest.fixture
async def seeded_player(pool):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, espn_player_id, full_name, first_name, last_name, position, pro_team)
            VALUES ($1, $2, 'Jahmyr Gibbs', 'Jahmyr', 'Gibbs', 'RB', 'DET')
            ON CONFLICT (sleeper_player_id) DO NOTHING
            """,
            _SLEEPER_ID, _ESPN_ID,
        )
    yield
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM players WHERE sleeper_player_id = $1", _SLEEPER_ID)


_GIBBS_OVER = {
    "legs": [{"description": "Jahmyr Gibbs Over 79.5 Rushing Yards", "market": "player_prop", "player_name": "Jahmyr Gibbs",
              "team_abbr": "DET", "stat_key": "rush_yd", "line": 79.5, "direction": "over"}],
    "stake": 10, "odds_american": -115,
}


async def test_a_bet_is_matched_graded_live_and_settled(pool, game_state, seeded_player):
    user_id = await make_safe_session_user_id(pool)
    async with _client() as c:
        res = await c.post("/bets", json=_GIBBS_OVER, cookies=_cookie(user_id))
        assert res.status_code == 200, res.text
        bet = res.json()
        leg = bet["legs"][0]
        assert leg["espn_event_id"] == _EVENT and leg["tracked"] and leg["current"] == 64 and leg["status"] == "open"
        assert bet["payout"] == pytest.approx(18.70)

        game_state["prop_stats"][_ESPN_ID]["stats"]["rush_yd"] = 85
        listed = (await c.get("/bets", cookies=_cookie(user_id))).json()
        assert listed["enabled"] and listed["bets"][0]["status"] == "won"

    # Settled for good: no box score needed to read it back.
    async with pool.acquire() as conn:
        assert await conn.fetchval("SELECT status FROM bets WHERE id = $1", bet["id"]) == "won"
        assert await conn.fetchval("SELECT final_value FROM bet_legs WHERE bet_id = $1", bet["id"]) == 85


async def test_bets_are_private_to_their_user(pool, game_state, seeded_player):
    mine = await make_safe_session_user_id(pool)
    theirs = await make_safe_session_user_id(pool)
    async with _client() as c:
        bet = (await c.post("/bets", json=_GIBBS_OVER, cookies=_cookie(mine))).json()
        assert (await c.get("/bets", cookies=_cookie(theirs))).json()["bets"] == []
        assert (await c.patch(f"/bets/{bet['id']}", json={"status": "lost"}, cookies=_cookie(theirs))).status_code == 404
        assert (await c.delete(f"/bets/{bet['id']}", cookies=_cookie(theirs))).status_code == 404
        assert (await c.get(f"/bets/shared/{bet['id']}", cookies=_cookie(theirs))).status_code == 404
        assert (await c.get(f"/bets/games/{_EVENT}", cookies=_cookie(theirs))).json()["bets"] == []
        assert len((await c.get(f"/bets/games/{_EVENT}", cookies=_cookie(mine))).json()["bets"]) == 1


async def test_sharing_posts_a_card_league_members_can_read_without_the_money(pool, game_state, seeded_player):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, 'Bettor') RETURNING owner_id",
            f"test-bets-owner-{uuid.uuid4().hex[:8]}",
        )
        conversation_id = await conn.fetchval("SELECT id FROM conversations WHERE type = 'league' AND league_id = $1", DEFAULT_LEAGUE_ID)
        await conn.execute(
            "INSERT INTO conversation_participants (conversation_id, owner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            conversation_id, owner_id,
        )
    bettor = await make_safe_session_user_id_for_owner(pool, owner_id)
    member = await make_safe_session_user_id(pool)
    outsider = await make_safe_session_user_id(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_members (league_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member') ON CONFLICT DO NOTHING",
            DEFAULT_LEAGUE_ID, bettor, member,
        )
        await conn.execute("UPDATE users SET active_league_id = NULL WHERE id = $1", outsider)
    try:
        async with _client() as c:
            bet = (await c.post("/bets", json=_GIBBS_OVER, cookies=_cookie(bettor, owner_id))).json()
            assert not bet["shared"]
            assert (await c.get(f"/bets/shared/{bet['id']}", cookies=_cookie(member))).status_code == 404

            shared = await c.post(f"/bets/{bet['id']}/share", cookies=_cookie(bettor, owner_id))
            assert shared.status_code == 200, shared.text
            assert shared.json()["posted"]
            again = (await c.post(f"/bets/{bet['id']}/share", cookies=_cookie(bettor, owner_id))).json()
            assert not again["posted"]

            seen = (await c.get(f"/bets/shared/{bet['id']}", cookies=_cookie(member))).json()
            assert seen["legs"][0]["current"] == 64 and "stake" not in seen and "payout" not in seen
            assert (await c.get(f"/bets/shared/{bet['id']}", cookies=_cookie(outsider))).status_code == 404

            await c.delete(f"/bets/{bet['id']}/share", cookies=_cookie(bettor, owner_id))
            assert (await c.get(f"/bets/shared/{bet['id']}", cookies=_cookie(member))).status_code == 404

        async with pool.acquire() as conn:
            assert await conn.fetchval("SELECT count(*) FROM messages WHERE bet_id = $1", bet["id"]) == 1
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM messages WHERE owner_id = $1", owner_id)
            await conn.execute("DELETE FROM conversation_participants WHERE owner_id = $1", owner_id)
            await conn.execute("DELETE FROM league_members WHERE user_id = ANY($1::int[])", [bettor, member])
            await conn.execute("DELETE FROM bets WHERE user_id = $1", bettor)
            await conn.execute("DELETE FROM owner_users WHERE owner_id = $1", owner_id)
            await conn.execute("DELETE FROM owners WHERE owner_id = $1", owner_id)


async def test_parse_slip_returns_a_checked_draft(pool, game_state, seeded_player, monkeypatch):
    def fake_reader(image_base64, media_type):
        return {
            "is_bet_slip": True, "sportsbook": "DraftKings", "stake": 5, "odds_american": 450,
            "legs": [
                {"description": "Jahmyr Gibbs 80+ Rushing Yards", "market": "player_prop", "player_name": "Jahmyr Gibbs",
                 "team_abbr": "DET", "stat_key": "rush_yd", "line": 79.5, "direction": "over"},
                {"description": "First TD: Amon-Ra St. Brown", "market": "other"},
            ],
        }

    monkeypatch.setattr(bets_router.bet_slip_reader, "read_bet_slip", fake_reader)
    user_id = await make_safe_session_user_id(pool)
    async with _client() as c:
        res = await c.post("/bets/parse-slip", json={"image_base64": "aGVsbG8=", "media_type": "image/png"}, cookies=_cookie(user_id))
        assert res.status_code == 200, res.text
        draft = res.json()
        assert draft["sportsbook"] == "DraftKings" and draft["legs"][0]["matched"] and draft["legs"][1]["market"] == "other"
        bad = await c.post("/bets/parse-slip", json={"image_base64": "not base64!", "media_type": "image/png"}, cookies=_cookie(user_id))
        assert bad.status_code == 422


async def test_turning_bet_tracking_off_hides_bets(pool, game_state, seeded_player):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, 'Off') RETURNING owner_id",
            f"test-bets-off-{uuid.uuid4().hex[:8]}",
        )
        await conn.execute("INSERT INTO owner_preferences (owner_id, bet_tracking_enabled) VALUES ($1, FALSE)", owner_id)
    user_id = await make_safe_session_user_id_for_owner(pool, owner_id)
    try:
        async with _client() as c:
            assert (await c.get("/bets", cookies=_cookie(user_id, owner_id))).json() == {"enabled": False, "bets": []}
            assert (await c.get(f"/bets/games/{_EVENT}", cookies=_cookie(user_id, owner_id))).json()["enabled"] is False
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM owner_preferences WHERE owner_id = $1", owner_id)
            await conn.execute("DELETE FROM owner_users WHERE owner_id = $1", owner_id)
            await conn.execute("DELETE FROM owners WHERE owner_id = $1", owner_id)
