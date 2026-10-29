"""
The showreel's demo league, built through the app's own API against a
local backend on a throwaway database (never production).

Every owner, team, chat line and result here is made up. NFL players are
real public figures, from the copied public players table.

    python seed_demo.py league     # sign-ups, league, teams, draft, schedule
"""
import json
import pathlib
import sys

import asyncio
import random

import asyncpg
import httpx

API = "http://127.0.0.1:8790"
DB = "postgresql://postgres@127.0.0.1:55432/showreel"
SEASON = 2026
PASSWORD = "showreel-demo-2026"
STATE = pathlib.Path(__file__).with_name("demo_accounts.json")

# Same league as the September web reel. Marcus is the viewer.
TEAMS = [
    ("Marcus", "Mahomes Alone"),
    ("Jordan", "Hurts Donut"),
    ("Tyler", "Bijan Mustard"),
    ("Dre", "Kittle Me Elmo"),
    ("Chris", "Nacua Matata"),
    ("Nate", "Brock Lobster"),
    ("Sam", "Gibbs Me Liberty"),
    ("Mike", "Chase the Bag"),
    ("Luis", "Saquon & On"),
    ("Kev", "Burrow Me a Title"),
    ("Derek", "Jefferson Airplane"),
    ("Ryan", "Henry the VIII"),
]


def email_for(owner: str) -> str:
    return f"{owner.lower()}@sundaysyndicate.invalid"


def call(method: str, path: str, token: str | None = None, **kw) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = httpx.request(method, API + path, headers=headers, timeout=60, **kw)
    if r.status_code >= 400:
        raise SystemExit(f"{method} {path} -> {r.status_code}: {r.text[:400]}")
    return r.json() if r.content else {}


def build_league() -> dict:
    accounts = []
    for owner, team in TEAMS:
        token = call("POST", "/auth/signup", json={"email": email_for(owner), "password": PASSWORD, "display_name": owner})["token"]
        accounts.append({"owner": owner, "team": team, "email": email_for(owner), "token": token})

    marcus = accounts[0]
    league = call("POST", "/leagues", marcus["token"], json={
        "name": "The Sunday Syndicate", "team_count": 12, "scoring": "ppr", "make_active": True,
    })
    for a in accounts[1:]:
        call("POST", "/leagues/join", a["token"], json={"invite_code": league["invite_code"], "make_active": True})
    for a in accounts:
        # A fresh token after joining, so the session carries the new
        # active league and owner.
        a["token"] = call("POST", "/auth/login", json={"email": a["email"], "password": PASSWORD})["token"]
        team = call("POST", f"/leagues/{league['id']}/teams", a["token"], json={"team_name": a["team"]})
        a["team_id"] = team.get("team_id") or team.get("id")
    state = {"league_id": league["id"], "invite_code": league["invite_code"], "accounts": accounts}
    STATE.write_text(json.dumps(state, indent=2))
    return state


ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7, "IR": 1}
ROUNDS = 16
# How many of each position a team ends the draft with.
TARGET = {"QB": 2, "RB": 5, "WR": 5, "TE": 2, "DEF": 1, "K": 1}


async def draft_pool() -> list[dict]:
    conn = await asyncpg.connect(DB)
    rows = await conn.fetch(
        # Team defenses carry no draft rank; they sort by projection
        # behind everyone else (and only go in the last rounds anyway).
        "SELECT sleeper_player_id, full_name, position, search_rank FROM players "
        "WHERE is_draftable AND pro_team IS NOT NULL AND position IN ('QB','RB','WR','TE','K','DEF') "
        "  AND (search_rank IS NOT NULL OR position = 'DEF') "
        "ORDER BY COALESCE(search_rank, 100000 - COALESCE(projected_avg_points, 0) * 100) LIMIT 1500"
    )
    await conn.close()
    return [dict(r) for r in rows]


def choose(pool: list[dict], have: dict[str, int], rnd: int, rng: random.Random) -> dict:
    """Best-ranked player a sensible manager would take here: kickers and
    defenses only in the last two rounds, never past a position's target,
    and whatever's still missing once the rounds run short."""
    left = ROUNDS - rnd + 1
    missing = {pos: n - have.get(pos, 0) for pos, n in TARGET.items() if n - have.get(pos, 0) > 0}
    must = [pos for pos in missing] if sum(missing.values()) >= left else None
    for p in pool[: 40]:
        pos = p["position"]
        if must is not None and pos not in must:
            continue
        if pos in ("K", "DEF") and left > 2:
            continue
        if have.get(pos, 0) >= TARGET[pos]:
            continue
        # A little variety, so it isn't a pure rank list.
        if rng.random() < 0.15:
            continue
        return p
    return next(p for p in pool if (must is None or p["position"] in must) and have.get(p["position"], 0) < TARGET[p["position"]])


def run_draft() -> None:
    state = json.loads(STATE.read_text())
    accounts = state["accounts"]
    by_team = {a["team_id"]: a for a in accounts}
    marcus = accounts[0]["token"]
    rng = random.Random(7)
    order = [a["team_id"] for a in accounts]
    rng.shuffle(order)
    httpx.post(API + "/draft/reset", headers={"Authorization": f"Bearer {marcus}"}, timeout=60)
    call("POST", "/draft/setup", marcus, json={"draft_order": order, "roster_slots": ROSTER_SLOTS, "pick_time_limit_seconds": 90})
    call("POST", "/draft/start", marcus)
    pool = asyncio.run(draft_pool())
    have = {t: {} for t in by_team}
    for pick in range(1, ROUNDS * len(order) + 1):
        rnd = (pick - 1) // len(order) + 1
        idx = (pick - 1) % len(order)
        team = order[idx] if rnd % 2 == 1 else order[-1 - idx]
        p = choose(pool, have[team], rnd, rng)
        call("POST", "/draft/pick", by_team[team]["token"], json={"sleeper_player_id": p["sleeper_player_id"]})
        pool.remove(p)
        have[team][p["position"]] = have[team].get(p["position"], 0) + 1
    state["draft_order"] = order
    STATE.write_text(json.dumps(state, indent=2))


async def team_rosters() -> dict[int, list[dict]]:
    conn = await asyncpg.connect(DB)
    rows = await conn.fetch(
        "SELECT c.team_id, c.sleeper_player_id, c.lineup_slot, p.position, COALESCE(p.projected_avg_points, 0) AS proj "
        "FROM current_rosters c JOIN players p USING (sleeper_player_id) WHERE c.season = $1",
        SEASON,
    )
    await conn.close()
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["team_id"], []).append(dict(r))
    return out


def relogin(state: dict) -> None:
    """Fresh tokens: a session minted before its owner had a team doesn't
    carry the owner."""
    for a in state["accounts"]:
        a["token"] = call("POST", "/auth/login", json={"email": a["email"], "password": PASSWORD})["token"]
    STATE.write_text(json.dumps(state, indent=2))


def set_lineups() -> None:
    """Each manager starts their best-projected players, through the same
    lineup endpoint My Team uses."""
    state = json.loads(STATE.read_text())
    by_team = {a["team_id"]: a for a in state["accounts"]}
    for team_id, roster in asyncio.run(team_rosters()).items():
        if any(r["lineup_slot"] not in ("BE", "IR") for r in roster):
            continue  # already set
        ranked = sorted(roster, key=lambda r: -float(r["proj"]))
        used: set[str] = set()

        def take(positions, n):
            got = [r for r in ranked if r["position"] in positions and r["sleeper_player_id"] not in used][:n]
            used.update(r["sleeper_player_id"] for r in got)
            return got

        plan = (
            [(r, "QB") for r in take({"QB"}, 1)]
            + [(r, "RB") for r in take({"RB"}, 2)]
            + [(r, "WR") for r in take({"WR"}, 2)]
            + [(r, "TE") for r in take({"TE"}, 1)]
            + [(r, "RB/WR/TE") for r in take({"RB", "WR", "TE"}, 1)]
            + [(r, "K") for r in take({"K"}, 1)]
            + [(r, "D/ST") for r in take({"DEF"}, 1)]
        )
        for r, slot in plan:
            call("POST", "/me/team/lineup/move", by_team[team_id]["token"], json={"sleeper_player_id": r["sleeper_player_id"], "to_slot": slot})


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "league"
    if step == "league":
        s = build_league()
        print(json.dumps({"league_id": s["league_id"], "teams": [(a["owner"], a.get("team_id")) for a in s["accounts"]]}))
    elif step == "draft":
        run_draft()
        print("draft done")
    elif step == "relogin":
        relogin(json.loads(STATE.read_text()))
    elif step == "lineups":
        set_lineups()
        print("lineups set")
