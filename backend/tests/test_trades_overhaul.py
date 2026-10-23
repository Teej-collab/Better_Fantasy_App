"""Trades overhaul (2026-10-23): values and lineup impact, drops that
ride along with a trade, counter offers, and the trade block."""
from app.domain import trade_values
from tests.conftest import TEST_SEASON
from tests.test_trades import (
    _client,
    _seed_player,
    _seed_roster_entry,
    _set_env,
    _set_review_mode,
    _setup_two_teams,
)


async def _project(pool, player_id, points, weeks=(1, 2, 3)):
    async with pool.acquire() as conn:
        for week in weeks:
            await conn.execute(
                "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
                "VALUES ($1, $2, $3, $4)",
                TEST_SEASON, week, player_id, points,
            )


def test_best_lineup_fills_single_slots_before_flex():
    players = [
        {"id": "a", "name": "A", "position": "RB", "per_week": 20},
        {"id": "b", "name": "B", "position": "RB", "per_week": 15},
        {"id": "c", "name": "C", "position": "WR", "per_week": 12},
    ]
    lineup = trade_values.best_lineup(players, {"RB": 1, "WR": 1, "RB/WR/TE": 1})
    assert [(e["slot"], e["player"]["id"]) for e in lineup] == [("RB", "a"), ("WR", "c"), ("RB/WR/TE", "b")]


async def test_evaluate_reads_value_and_lineup_change(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "ovr-eval")
    await _project(pool, give_player, 10)
    await _project(pool, receive_player, 16)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.post(
            "/trades/evaluate",
            json={"partner_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["value_change"] == 6.0
    assert body["verdict"] == "you"
    assert body["my_lineup"]["change"] == 6.0
    assert body["their_lineup_change"] == -6.0
    assert body["my_drops_needed"] == 0


async def test_two_for_one_needs_a_drop_and_drops_it_when_the_trade_goes_through(pool, monkeypatch):
    _set_env(monkeypatch)
    await _set_review_mode(pool, "none")
    a, b, give_player, receive_player = await _setup_two_teams(pool, "ovr-drop")
    second = await _seed_player(pool, "ovr-drop-second", "WR")
    await _seed_roster_entry(pool, a["team_id"], second)
    # Fill b's roster to its 8-player limit.
    fillers = []
    for i in range(7):
        pid = await _seed_player(pool, f"ovr-drop-fill-{i}", "WR")
        await _seed_roster_entry(pool, b["team_id"], pid)
        fillers.append(pid)

    async with _client() as client:
        # b proposes taking two for one: b has to name its own drop.
        client.cookies.update(b["cookies"])
        refused = await client.post(
            "/trades", json={"receiving_team_id": a["team_id"], "give": [receive_player], "receive": [give_player, second]}
        )
        assert refused.status_code == 400

    async with _client() as client:
        client.cookies.update(b["cookies"])
        evaluation = await client.post(
            "/trades/evaluate",
            json={"partner_team_id": a["team_id"], "give": [receive_player], "receive": [give_player, second]},
        )
        assert evaluation.json()["my_drops_needed"] == 1
        assert {c["id"] for c in evaluation.json()["drop_candidates"]} == set(fillers)

        proposed = await client.post(
            "/trades",
            json={"receiving_team_id": a["team_id"], "give": [receive_player], "receive": [give_player, second],
                  "drops": [fillers[0]]},
        )
        assert proposed.status_code == 200, proposed.text
        assert [d["sleeper_player_id"] for d in proposed.json()["drops"]] == [fillers[0]]

    async with _client() as client:
        client.cookies.update(a["cookies"])
        accepted = await client.post(f"/trades/{proposed.json()['id']}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"

    async with pool.acquire() as conn:
        b_roster = {
            r["sleeper_player_id"]
            for r in await conn.fetch("SELECT sleeper_player_id FROM current_rosters WHERE team_id = $1", b["team_id"])
        }
    assert fillers[0] not in b_roster
    assert {give_player, second} <= b_roster
    assert len(b_roster) == 8


async def test_receiver_picks_a_drop_when_accepting(pool, monkeypatch):
    _set_env(monkeypatch)
    await _set_review_mode(pool, "none")
    a, b, give_player, receive_player = await _setup_two_teams(pool, "ovr-acc")
    second = await _seed_player(pool, "ovr-acc-second", "WR")
    await _seed_roster_entry(pool, a["team_id"], second)

    fillers = []
    for i in range(7):
        pid = await _seed_player(pool, f"ovr-acc-fill-{i}", "WR")
        await _seed_roster_entry(pool, b["team_id"], pid)
        fillers.append(pid)

    async with _client() as client:
        # b's roster is full, but the offer still goes: b drops on accept.
        client.cookies.update(a["cookies"])
        proposed = await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player, second], "receive": [receive_player]}
        )
    assert proposed.status_code == 200, proposed.text
    trade_id = proposed.json()["id"]

    async with _client() as client:
        client.cookies.update(b["cookies"])
        evaluation = await client.get(f"/trades/{trade_id}/evaluation")
        assert evaluation.status_code == 200, evaluation.text
        assert evaluation.json()["my_drops_needed"] == 1
        refused = await client.post(f"/trades/{trade_id}/accept")
        assert refused.status_code == 400
        accepted = await client.post(f"/trades/{trade_id}/accept", json={"drops": [fillers[3]]})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    async with pool.acquire() as conn:
        still = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE team_id = $1 AND sleeper_player_id = $2", b["team_id"], fillers[3]
        )
    assert still is None


async def test_counter_declines_the_original_and_sends_a_new_offer(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "ovr-counter")
    extra = await _seed_player(pool, "ovr-counter-extra", "WR")
    await _seed_roster_entry(pool, a["team_id"], extra)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        original = (await client.post(
            "/trades", json={"receiving_team_id": b["team_id"], "give": [give_player], "receive": [receive_player]}
        )).json()

    async with _client() as client:
        client.cookies.update(b["cookies"])
        counter = await client.post(
            "/trades",
            json={"receiving_team_id": a["team_id"], "give": [receive_player], "receive": [give_player, extra],
                  "counter_of": original["id"]},
        )
        assert counter.status_code == 200, counter.text
        again = await client.post(
            "/trades",
            json={"receiving_team_id": a["team_id"], "give": [receive_player], "receive": [give_player],
                  "counter_of": original["id"]},
        )
        assert again.status_code == 409

    async with _client() as client:
        client.cookies.update(a["cookies"])
        mine = (await client.get("/trades/mine")).json()["trades"]
    by_id = {t["id"]: t for t in mine}
    assert by_id[original["id"]]["status"] == "rejected"
    assert by_id[counter.json()["id"]]["status"] == "pending"
    assert by_id[counter.json()["id"]]["value"]["verdict"] in ("you", "them", "even")


async def test_trade_block_lists_only_players_still_on_the_listing_team(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "ovr-block")

    async with _client() as client:
        client.cookies.update(a["cookies"])
        assert (await client.post("/trades/block", json={"sleeper_player_id": receive_player})).status_code == 400
        assert (await client.post("/trades/block", json={"sleeper_player_id": give_player})).status_code == 200
        listed = (await client.get("/trades/block")).json()["players"]
        assert [p["sleeper_player_id"] for p in listed if p["team_id"] == a["team_id"]] == [give_player]
        roster = (await client.get(f"/trades/teams/{a['team_id']}/roster")).json()["roster"]
        assert next(p for p in roster if p["sleeper_player_id"] == give_player)["on_block"] is True

        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM current_rosters WHERE team_id = $1 AND sleeper_player_id = $2", a["team_id"], give_player
            )
        listed = (await client.get("/trades/block")).json()["players"]
        assert all(p["sleeper_player_id"] != give_player for p in listed)

        assert (await client.delete(f"/trades/block/{give_player}")).status_code == 200


async def test_listing_on_the_block_tells_the_rest_of_the_league(pool, monkeypatch):
    _set_env(monkeypatch)
    from app.notifications import dispatcher
    from app.queries import owner_preferences

    sent = []

    async def fake_send(conn, owner_id, payload, now=None):
        sent.append((owner_id, payload))
        return 1

    async def prefs(conn, owner_id):
        return {"push_enabled": True, "notify_league": True}

    monkeypatch.setattr(dispatcher, "send_to_owner", fake_send)
    monkeypatch.setattr(owner_preferences, "get_preferences", prefs)
    a, b, give_player, _ = await _setup_two_teams(pool, "ovr-push")
    second = await _seed_player(pool, "ovr-push-second", "WR")
    await _seed_roster_entry(pool, a["team_id"], second)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        await client.post("/trades/block", json={"sleeper_player_id": give_player})
        await client.post("/trades/block", json={"sleeper_player_id": give_player})  # already listed: no push
        await client.post("/trades/block", json={"sleeper_player_id": second})

    to_b = [p for owner, p in sent if owner == b["owner_id"]]
    assert len(to_b) == 2
    assert to_b[-1]["title"] == "📣 Team ovr-pusha is shopping Test Player ovr-push-give and Test Player ovr-push-second"
    assert all(owner != a["owner_id"] for owner, _ in sent)


async def test_player_card_says_when_a_player_is_on_the_block(pool, monkeypatch):
    _set_env(monkeypatch)
    from app.domain import player_card

    monkeypatch.setattr(player_card, "get_player_info", lambda *a, **k: None)
    a, _, give_player, _ = await _setup_two_teams(pool, "ovr-card")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO trade_block (league_id, season, team_id, sleeper_player_id) "
            "SELECT league_id, season, id, $2 FROM teams_by_season WHERE id = $1",
            a["team_id"], give_player,
        )
        league_id = await conn.fetchval("SELECT league_id FROM teams_by_season WHERE id = $1", a["team_id"])
        card = await player_card.get_player_card(conn, give_player, season=TEST_SEASON, league_id=league_id, my_owner_id=a["owner_id"])
    assert card["is_on_my_team"] is True
    assert card["on_trade_block"] is True


async def test_partners_puts_a_team_that_needs_what_you_have_first(pool, monkeypatch):
    _set_env(monkeypatch)
    a, b, give_player, receive_player = await _setup_two_teams(pool, "ovr-fit")
    # a: three good RBs (RB + FLEX start, the third sits on the bench). b: a weak RB.
    backup = await _seed_player(pool, "ovr-fit-backup", "RB")
    third = await _seed_player(pool, "ovr-fit-third", "RB")
    await _seed_roster_entry(pool, a["team_id"], backup)
    await _seed_roster_entry(pool, a["team_id"], third)
    await _project(pool, give_player, 18)
    await _project(pool, backup, 14)
    await _project(pool, third, 12)
    await _project(pool, receive_player, 3)

    async with _client() as client:
        client.cookies.update(a["cookies"])
        resp = await client.get("/trades/partners")
    assert resp.status_code == 200, resp.text
    teams = resp.json()["teams"]
    mine = next(t for t in teams if t["team_id"] == b["team_id"])
    assert all(t["team_id"] != a["team_id"] for t in teams)
    assert "RB" in mine["needs"]
    assert mine["fit"] >= 1
    assert mine["fit_reason"] == "They need RB, you're deep there"
    assert teams[0]["fit"] >= mine["fit"]
