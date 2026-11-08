"""NFL survivor pools (app/domain/survivor.py, app/routers/survivor.py)."""
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient

from app.domain import survivor
from app.main import app
from tests.conftest import TEST_SEASON

POOL = {"lives": 1, "tie_counts_as": "loss", "double_from_week": None, "buyback_until_week": None}


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _game(away, home, kickoff, *, state="pre", away_score=None, home_score=None):
    return {
        "id": f"{away}@{home}", "away_team": away, "home_team": home, "date": kickoff.strftime("%Y-%m-%dT%H:%MZ"),
        "state": state, "completed": state == "post", "away_score": away_score, "home_score": home_score,
    }


def test_lives_ties_and_buyback():
    picks = [{"week": 1, "slot": 1, "result": "win"}, {"week": 2, "slot": 1, "result": "tie"}, {"week": 3, "slot": 1, "result": "loss"}]
    assert survivor.status(POOL, {"bought_back": False}, picks) == {"lives_total": 1, "lives_left": 0, "eliminated_week": 2}
    assert survivor.status({**POOL, "tie_counts_as": "win"}, {"bought_back": False}, picks) == {"lives_total": 1, "lives_left": 0, "eliminated_week": 3}
    two = {**POOL, "lives": 2}
    assert survivor.status(two, {"bought_back": False}, picks) == {"lives_total": 2, "lives_left": 0, "eliminated_week": 3}
    # A buyback is one more life.
    assert survivor.status(two, {"bought_back": True}, picks) == {"lives_total": 3, "lives_left": 1, "eliminated_week": None}
    # Double-pick weeks: two losses in one week cost two lives.
    double = [{"week": 12, "slot": 1, "result": "loss"}, {"week": 12, "slot": 2, "result": "loss"}]
    assert survivor.status(two, {"bought_back": False}, double)["eliminated_week"] == 12
    assert survivor.slots({"double_from_week": 12}, 11) == 1 and survivor.slots({"double_from_week": 12}, 12) == 2


def test_win_chance_and_deadline():
    assert round(survivor.win_prob(10) * 100) == 77  # a 10-point favorite
    assert survivor.win_prob(0) == 0.5
    thu = datetime(2026, 11, 13, 1, 15, tzinfo=UTC)  # Thursday 8:15 PM ET
    london = datetime(2026, 11, 15, 14, 30, tzinfo=UTC)
    one_pm = datetime(2026, 11, 15, 18, 0, tzinfo=UTC)
    sched = survivor.schedule([_game("WSH", "NYG", thu), _game("NE", "DET", london), _game("KC", "ATL", one_pm)])
    assert survivor.sunday_deadline(sched) == one_pm
    final = survivor.schedule([_game("KC", "ATL", one_pm, state="post", away_score="27", home_score="20")])
    assert survivor.grade("KC", final["KC"]) == "win" and survivor.grade("ATL", final["ATL"]) == "loss"
    assert survivor.grade("KC", sched["KC"]) is None


async def _signup(client, who):
    resp = await client.post("/auth/signup", json={"email": f"test-surv-{who}@example.com", "password": "correct-horse", "display_name": who.title()})
    assert resp.status_code in (200, 201), resp.text


def _fake_schedule(monkeypatch, state):
    async def week_scoreboard(week, year, season_type=2):
        return state["weeks"].get(week, [])

    async def real_week():
        return state["week"]

    monkeypatch.setattr(survivor.nfl_scoreboard, "get_week_scoreboard", week_scoreboard)
    monkeypatch.setattr(survivor.nfl_scoreboard, "get_real_current_week", real_week)


async def test_a_pool_from_join_to_last_one_standing(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    soon = datetime.now(UTC) + timedelta(days=2)
    state = {"week": 5, "weeks": {5: [_game("KC", "ATL", soon), _game("BUF", "NYJ", soon + timedelta(hours=3))]}}
    _fake_schedule(monkeypatch, state)
    async with _client() as a, _client() as b:
        await _signup(a, "alpha")
        await _signup(b, "bravo")
        made = await a.post("/survivor/pools", json={"name": "Office Eliminator", "max_entries": 2})
        assert made.status_code == 200, made.text
        code, pool_id = made.json()["join_code"], made.json()["id"]
        assert (await b.post("/survivor/join", json={"code": "nope"})).status_code == 404
        joined = await b.post("/survivor/join", json={"code": code.lower()})
        assert joined.status_code == 200, joined.text

        hub = (await a.get("/survivor/pools")).json()
        mine = next(p for p in hub["pools"] if p["id"] == pool_id)
        assert mine["entries"] == 2 and mine["mine"][0]["needs_pick"] is True and mine["can_add_entry"] is True
        a_entry, b_entry = mine["mine"][0]["entry_id"], joined.json()["entry_id"]

        board = (await a.get(f"/survivor/entries/{a_entry}/board")).json()
        assert board["week"] == 5 and board["slots"] == 1 and len(board["games"]) == 2
        assert "CHI" in board["byes"]
        picked = await a.put(f"/survivor/entries/{a_entry}/picks", json={"teams": ["KC"]})
        assert picked.status_code == 200, picked.text
        assert [p["team"] for p in picked.json()["picks"]] == ["KC"]
        assert (await b.put(f"/survivor/entries/{b_entry}/picks", json={"teams": ["BUF", "KC"]})).status_code == 409
        assert (await b.put(f"/survivor/entries/{b_entry}/picks", json={"teams": ["ATL"]})).status_code == 200
        # Someone else's pick stays hidden until its game starts.
        field = (await b.get(f"/survivor/pools/{pool_id}")).json()["field"]
        alpha = next(r for r in field["rows"] if r["name"] == "Alpha")
        assert alpha["picks"] == [{"week": 5, "slot": 1, "hidden": True}]

        # KC @ ATL kicks off: both picks lock and show.
        state["weeks"][5][0] = _game("KC", "ATL", datetime.now(UTC) - timedelta(minutes=5), state="in")
        async with pool.acquire() as conn:
            await conn.execute("UPDATE survivor_picks SET kickoff = now() - interval '5 minutes' WHERE team IN ('KC', 'ATL')")
        changed = await a.put(f"/survivor/entries/{a_entry}/picks", json={"teams": ["BUF"]})
        assert changed.status_code == 409 and "locked" in changed.json()["detail"]
        field = (await b.get(f"/survivor/pools/{pool_id}")).json()["field"]
        alpha = next(r for r in field["rows"] if r["name"] == "Alpha")
        assert alpha["picks"][0]["team"] == "KC"
        assert field["popularity"][0]["week"] == 5
        # The pool started, so it's closed to new entries.
        assert (await a.post("/survivor/join", json={"code": code})).status_code == 409

        # Final: KC wins, ATL loses — Bravo's out and Alpha is the last one standing.
        state["weeks"][5] = [_game("KC", "ATL", soon - timedelta(days=3), state="post", away_score="27", home_score="20"),
                             _game("BUF", "NYJ", soon - timedelta(days=3), state="post", away_score="30", home_score="10")]
        state["week"] = 6
        state["weeks"][6] = [_game("KC", "DEN", soon), _game("NYJ", "MIA", soon)]
        async with pool.acquire() as conn:
            results = await survivor.run(conn, TEST_SEASON)
        assert results["graded"] == 2
        detail = (await a.get(f"/survivor/pools/{pool_id}")).json()
        assert detail["alive"] == 1 and detail["winners"] == ["Alpha"]
        # KC is used up for Alpha.
        reuse = await a.put(f"/survivor/entries/{a_entry}/picks", json={"teams": ["KC"]})
        assert reuse.status_code == 409 and "already used KC" in reuse.json()["detail"]
        out = await b.put(f"/survivor/entries/{b_entry}/picks", json={"teams": ["MIA"]})
        assert out.status_code == 409 and "out" in out.json()["detail"]
        planner = (await a.get(f"/survivor/entries/{a_entry}/planner")).json()
        assert "KC" not in {r["team"] for r in planner["rows"]} and planner["weeks"][0] == 6


async def test_missed_picks_auto_pick_the_favorite_or_count_as_a_loss(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    deadline = (datetime.now(UTC) + timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    while deadline.weekday() != 6:
        deadline += timedelta(days=1)  # the next Sunday, 1 PM ET
    state = {"week": 7, "weeks": {7: [_game("JAX", "TEN", deadline), _game("SF", "DAL", deadline + timedelta(hours=3)),
                                      _game("CHI", "GB", deadline)]}}
    _fake_schedule(monkeypatch, state)
    async with _client() as a:
        await _signup(a, "charlie")
        auto = (await a.post("/survivor/pools", json={"name": "Auto Pool", "start_week": 7})).json()
        loss = (await a.post("/survivor/pools", json={"name": "Loss Pool", "start_week": 7, "missed_pick": "loss", "lives": 2})).json()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE survivor_entries SET created_at = now() - interval '30 days' WHERE pool_id = ANY($1::int[])", [auto["id"], loss["id"]])
        await conn.executemany(
            "INSERT INTO nfl_game_lines (season, week, team, opponent, is_home, spread) VALUES ($1, 7, $2, $3, $4, $5)",
            [(TEST_SEASON, "JAX", "TEN", False, -10.0), (TEST_SEASON, "TEN", "JAX", True, 10.0),
             (TEST_SEASON, "SF", "DAL", False, -3.5), (TEST_SEASON, "DAL", "SF", True, 3.5)],
        )
        await survivor.run(conn, TEST_SEASON, now=deadline - timedelta(hours=1))
        assert not await conn.fetchval("SELECT count(*) FROM survivor_picks")  # not yet
        await survivor.run(conn, TEST_SEASON, now=deadline - timedelta(minutes=2))
        picks = await conn.fetch(
            "SELECT p.name, sp.team, sp.auto FROM survivor_picks sp JOIN survivor_entries e ON e.id = sp.entry_id "
            "JOIN survivor_pools p ON p.id = e.pool_id WHERE p.id = ANY($1::int[])",
            [auto["id"], loss["id"]],
        )
        assert [(r["name"], r["team"], r["auto"]) for r in picks] == [("Auto Pool", "JAX", True)]
        # The week ends: the loss pool's missing pick costs a life.
        state["weeks"][7] = [{**g, "state": "post", "completed": True, "home_score": "10", "away_score": "20"} for g in state["weeks"][7]]
        await survivor.run(conn, TEST_SEASON, now=deadline + timedelta(hours=8))
        rows = await conn.fetch(
            "SELECT p.name, sp.team, sp.result FROM survivor_picks sp JOIN survivor_entries e ON e.id = sp.entry_id "
            "JOIN survivor_pools p ON p.id = e.pool_id WHERE p.id = ANY($1::int[]) ORDER BY p.name",
            [auto["id"], loss["id"]],
        )
        assert [(r["name"], r["team"], r["result"]) for r in rows] == [("Auto Pool", "JAX", "win"), ("Loss Pool", None, "missed")]
        alive = await conn.fetchval("SELECT eliminated_week FROM survivor_entries WHERE pool_id = $1", loss["id"])
        assert alive is None  # two lives, one gone


async def test_only_the_commissioner_makes_a_league_pool(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    _fake_schedule(monkeypatch, {"week": 3, "weeks": {3: [_game("KC", "ATL", datetime.now(UTC) + timedelta(days=1))]}})
    async with _client() as a, _client() as b:
        await _signup(a, "delta")
        await _signup(b, "echo")
        assert (await a.post("/leagues", json={"name": "Test League Survivor"})).status_code in (200, 201)
        made = await a.post("/survivor/pools", json={"name": "League Survivor", "for_league": True})
        assert made.status_code == 200, made.text
        hub = (await a.get("/survivor/pools")).json()
        assert hub["league"]["is_commissioner"] is True
        assert next(p for p in hub["pools"] if p["id"] == made.json()["id"])["league_name"] == "Test League Survivor"
        # Not a member: the code alone doesn't get you in.
        nope = await b.post("/survivor/join", json={"code": made.json()["join_code"]})
        assert nope.status_code == 403
        assert (await b.post("/survivor/pools", json={"name": "Mine", "for_league": True})).status_code == 403
