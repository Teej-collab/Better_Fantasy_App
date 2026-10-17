"""League Bets (app/routers/league_bets.py): the league's shared bets,
The Board, by-game, member cards, tails, reactions and follows. Runs in
a throwaway league so no real league ever sees test bets."""
import uuid

import pytest

from app.queries import leagues as league_queries
from tests.conftest import make_safe_session_user_id
from tests.test_bets_router import _EVENT, _GIBBS_OVER, _client, _cookie, game_state, seeded_player  # noqa: F401


@pytest.fixture
async def league(pool):
    """A throwaway league with a bettor, a member and an outsider."""
    bettor = await make_safe_session_user_id(pool)
    member = await make_safe_session_user_id(pool)
    outsider = await make_safe_session_user_id(pool)
    async with pool.acquire() as conn:
        league_id = await league_queries.create_league(conn, "Test League Bets", bettor, f"T{uuid.uuid4().hex[:7].upper()}")
        for user_id in (bettor, member):
            await league_queries.add_member(conn, league_id, user_id, "member")
            await conn.execute("UPDATE users SET active_league_id = $1 WHERE id = $2", league_id, user_id)
        await conn.execute("UPDATE users SET active_league_id = NULL WHERE id = $1", outsider)
    yield {"id": league_id, "bettor": bettor, "member": member, "outsider": outsider}
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM bet_follows WHERE follower_user_id = ANY($1::int[])", [bettor, member])
        await conn.execute("DELETE FROM bets WHERE user_id = ANY($1::int[])", [bettor, member, outsider])
        await conn.execute("UPDATE users SET active_league_id = NULL WHERE id = ANY($1::int[])", [bettor, member])
        await conn.execute("DELETE FROM league_members WHERE league_id = $1", league_id)
        await conn.execute("DELETE FROM leagues WHERE id = $1", league_id)


async def _shared_bet(pool, c, user_id, body):
    bet = (await c.post("/bets", json=body, cookies=_cookie(user_id))).json()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE bets SET shared_at = now() WHERE id = $1", bet["id"])
    return bet


async def test_the_feed_shows_shared_bets_to_the_league_without_the_money(pool, league, game_state, seeded_player):
    async with _client() as c:
        shared = await _shared_bet(pool, c, league["bettor"], _GIBBS_OVER)
        private = (await c.post("/bets", json=_GIBBS_OVER, cookies=_cookie(league["bettor"]))).json()

        res = await c.get("/bets/league", cookies=_cookie(league["member"]))
        assert res.status_code == 200, res.text
        feed = res.json()
        ids = [b["id"] for b in feed["bets"]]
        assert shared["id"] in ids and private["id"] not in ids
        card = feed["bets"][0]
        assert "stake" not in card and "payout" not in card and "note" not in card
        assert card["member"]["user_id"] == league["bettor"] and not card["mine"] and card["this_week"]
        assert feed["sweat"]["alive"] == 1
        assert (await c.get("/bets/league", cookies=_cookie(league["outsider"]))).status_code == 409

        # By game: everyone's line on one bar.
        games = (await c.get("/bets/league/games", cookies=_cookie(league["member"]))).json()["games"]
        assert games[0]["event_id"] == _EVENT and games[0]["legs"] == 1
        game = (await c.get(f"/bets/league/games/{_EVENT}", cookies=_cookie(league["member"]))).json()
        assert game["props"][0]["player_name"] == "Jahmyr Gibbs" and game["props"][0]["current"] == 64
        assert game["props"][0]["entries"][0]["line"] == 79.5
        assert game["rooting"] == [{"team": "DET", "share": 1.0}]


async def test_tail_fade_sweat_and_follow(pool, league, game_state, seeded_player):
    async with _client() as c:
        bet = await _shared_bet(pool, c, league["bettor"], _GIBBS_OVER)
        me, them = _cookie(league["member"]), _cookie(league["bettor"])

        # Fade, then tail: tailing drops the fade and saves your own copy.
        assert (await c.put(f"/bets/league/bets/{bet['id']}/reactions/fade", cookies=me)).json()["fade"] == {"count": 1, "mine": True}
        tail = await c.post(f"/bets/league/bets/{bet['id']}/tail", cookies=me)
        assert tail.status_code == 200, tail.text
        again = (await c.post(f"/bets/league/bets/{bet['id']}/tail", cookies=me)).json()
        assert again["bet_id"] == tail.json()["bet_id"]
        mine = (await c.get("/bets", cookies=me)).json()["bets"]
        copy = next(b for b in mine if b["id"] == tail.json()["bet_id"])
        assert copy["stake"] is None and not copy["shared"] and copy["legs"][0]["player_name"] == "Jahmyr Gibbs"
        assert (await c.put(f"/bets/league/bets/{bet['id']}/reactions/fade", cookies=me)).status_code == 409
        assert (await c.post(f"/bets/league/bets/{bet['id']}/tail", cookies=them)).status_code == 409
        assert (await c.put(f"/bets/league/bets/{bet['id']}/reactions/sweat", cookies=them)).json()["sweat"]["count"] == 1

        card = next(b for b in (await c.get("/bets/league", cookies=me)).json()["bets"] if b["id"] == bet["id"])
        assert card["tails"]["count"] == 1 and card["tails"]["mine"]
        assert card["reactions"]["fade"]["count"] == 0 and card["reactions"]["sweat"]["count"] == 1

        # Follow from their betting card.
        assert (await c.put(f"/bets/league/members/{league['bettor']}/follow", cookies=me)).json()["following"]
        profile = (await c.get(f"/bets/league/members/{league['bettor']}", cookies=me)).json()
        assert profile["following"] and profile["record"]["open"] == 1 and profile["vs"] is not None
        assert (await c.put(f"/bets/league/members/{league['member']}/follow", cookies=me)).status_code == 409
        assert (await c.get(f"/bets/league/members/{league['outsider']}", cookies=me)).status_code == 404


async def test_the_board_ranks_settled_bets_by_units(pool, league, game_state, seeded_player):
    async with _client() as c:
        win = await _shared_bet(pool, c, league["bettor"], _GIBBS_OVER | {"odds_american": 450})
        loss = await _shared_bet(pool, c, league["member"], _GIBBS_OVER)
        await c.patch(f"/bets/{win['id']}", json={"status": "won"}, cookies=_cookie(league["bettor"]))
        await c.patch(f"/bets/{loss['id']}", json={"status": "lost"}, cookies=_cookie(league["member"]))

        board = (await c.get("/bets/league/board", cookies=_cookie(league["member"]))).json()
        rows = board["rows"]
        assert [r["user_id"] for r in rows] == [league["bettor"], league["member"]]
        assert rows[0]["units"] == 4.5 and rows[0]["streak"] == "W1" and rows[1]["units"] == -1.0 and rows[1]["me"]
        assert board["trophies"]["longest_shot"]["odds_american"] == 450
        week = (await c.get("/bets/league/board?range=week", cookies=_cookie(league["member"]))).json()
        assert week["range"] == "week" and len(week["rows"]) == 2
