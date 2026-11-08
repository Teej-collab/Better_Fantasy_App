"""
NFL survivor pools (2026-11-07), like Sleeper's Survivor and ESPN's
Eliminator. Each week every entry picks NFL teams to win (two a week
from the pool's double_from_week), never the same team twice. A loss
costs a life; a tie counts as the pool says; running out of lives is
elimination. An eliminated entry may buy back in once (one life) through
buyback_until_week.

Locks are per game: a pick can be made or changed until its game kicks
off, and only then do the other entries see it. A missed pick is either
made for the entry (the biggest favorite it has left, just before the
Sunday 1 PM games) or counts as a loss, by the pool's rule.

Win chances come from the Vegas spread (nfl_game_lines, synced by the
projection engine) for this week, and from the projection engine's own
D/ST lines (each defense's projected points allowed) for later weeks,
turned into a win probability with the usual ~13.5-point spread spread.

The schedule and scores are ESPN's public scoreboard
(app/providers/nfl_scoreboard.py), keyed by team_code abbreviations.
"""
import json
import math
import secrets
from datetime import UTC, datetime, timedelta

from app.providers import nfl_scoreboard
from app.providers.projection_feeds import team_code

LAST_WEEK = 18
SIGMA = 13.45
# The auto-pick runs this long before the Sunday deadline, and the
# "make your pick" pushes go out this long before a lock.
AUTO_LEAD = timedelta(minutes=5)
REMINDERS = {"first": timedelta(hours=3), "sunday": timedelta(hours=2)}
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def win_prob(margin: float) -> float:
    """Chance a team expected to win by `margin` points wins."""
    return 0.5 * (1 + math.erf(margin / (SIGMA * math.sqrt(2))))


def slots(pool: dict, week: int) -> int:
    return 2 if pool.get("double_from_week") and week >= pool["double_from_week"] else 1


def new_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def _kickoff(game: dict) -> datetime | None:
    raw = game.get("date")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def schedule(games: list[dict]) -> dict[str, dict]:
    """{team: {opponent, home, kickoff, state, score, opp_score, game}} for
    one week's scoreboard. Teams on a bye are absent."""
    out = {}
    for g in games:
        home, away = team_code(g.get("home_team")), team_code(g.get("away_team"))
        if not home or not away:
            continue
        kickoff = _kickoff(g)
        for team, opp, is_home, score, opp_score in (
            (home, away, True, g.get("home_score"), g.get("away_score")),
            (away, home, False, g.get("away_score"), g.get("home_score")),
        ):
            out[team] = {
                "opponent": opp, "home": is_home, "kickoff": kickoff, "state": g.get("state"),
                "final": bool(g.get("completed")), "score": score, "opp_score": opp_score, "game": g.get("id") or f"{away}@{home}",
            }
    return out


async def week_schedule(season: int, week: int) -> dict[str, dict]:
    return schedule(await nfl_scoreboard.get_week_scoreboard(week, season))


def locked(game: dict | None, now: datetime) -> bool:
    return bool(game) and (game["state"] in ("in", "post") or (game["kickoff"] is not None and game["kickoff"] <= now))


def sunday_deadline(sched: dict[str, dict]) -> datetime | None:
    """When a missed pick is made for the entry: the week's first Sunday
    afternoon kickoff (the 1 PM ET games), else its last kickoff."""
    kickoffs = sorted({g["kickoff"] for g in sched.values() if g["kickoff"]})
    sunday = [k for k in kickoffs if k.weekday() == 6 and k.hour >= 17]
    return sunday[0] if sunday else (kickoffs[-1] if kickoffs else None)


def grade(team: str, game: dict | None) -> str | None:
    """'win' | 'loss' | 'tie' once the team's game is final."""
    if not game or not game["final"]:
        return None
    try:
        score, opp = float(game["score"]), float(game["opp_score"])
    except (TypeError, ValueError):
        return None
    return "win" if score > opp else "loss" if score < opp else "tie"


def loss_weeks(pool: dict, picks: list[dict]) -> list[int]:
    """One week per life lost, in order."""
    out = []
    for p in sorted(picks, key=lambda p: (p["week"], p["slot"])):
        r = p.get("result")
        if r in ("loss", "missed") or (r == "tie" and pool["tie_counts_as"] == "loss"):
            out.append(p["week"])
    return out


def status(pool: dict, entry: dict, picks: list[dict]) -> dict:
    """{lives_left, eliminated_week}: lives plus a bought-back life,
    minus the losses; out the week the last life went."""
    budget = pool["lives"] + (1 if entry.get("bought_back") else 0)
    losses = loss_weeks(pool, picks)
    return {
        "lives_total": budget,
        "lives_left": max(0, budget - len(losses)),
        "eliminated_week": losses[budget - 1] if len(losses) >= budget else None,
    }


async def current_week(season: int) -> int:
    """The week being picked: the real NFL week, or the next one once
    every game in it is final."""
    week = await nfl_scoreboard.get_real_current_week() or 1
    games = await nfl_scoreboard.get_week_scoreboard(week, season)
    if games and nfl_scoreboard.is_week_final(games):
        week += 1
    return max(1, min(LAST_WEEK, week))


async def win_chances(conn, season: int, week: int, sched: dict[str, dict]) -> dict[str, int | None]:
    """{team: win % (0–100) or None}: the Vegas spread when one is
    saved, else the projection engine's D/ST lines."""
    out: dict[str, int | None] = {t: None for t in sched}
    for r in await conn.fetch("SELECT team, spread FROM nfl_game_lines WHERE season = $1 AND week = $2", season, week):
        team = team_code(r["team"])
        if team in out and r["spread"] is not None:
            out[team] = round(100 * win_prob(-float(r["spread"])))
    allowed: dict[str, float] = {}
    for r in await conn.fetch(
        "SELECT sleeper_player_id, line FROM projection_lines WHERE season = $1 AND week = $2 AND source = 'model' AND line ? '_pts_allow'",
        season, week,
    ):
        allowed[team_code(r["sleeper_player_id"])] = float(json.loads(r["line"])["_pts_allow"])
    for team, game in sched.items():
        if out[team] is None and team in allowed and game["opponent"] in allowed:
            # A team scores what the other defense allows.
            out[team] = round(100 * win_prob(allowed[game["opponent"]] - allowed[team]))
    return out


# ---- reads ----------------------------------------------------------------

_NAME = """COALESCE(u.display_name, (SELECT o.display_name FROM owner_users ou JOIN owners o ON o.owner_id = ou.owner_id
                                      WHERE ou.user_id = u.id ORDER BY ou.owner_id LIMIT 1), u.username, 'Player')"""


async def pool_row(conn, pool_id: int) -> dict | None:
    row = await conn.fetchrow(
        "SELECT p.*, l.name AS league_name FROM survivor_pools p LEFT JOIN leagues l ON l.id = p.league_id WHERE p.id = $1",
        pool_id,
    )
    return dict(row) if row else None


async def entries_with_picks(conn, pool_id: int) -> list[dict]:
    entries = [
        dict(r) for r in await conn.fetch(
            f"""
            SELECT e.*, {_NAME} AS name
            FROM survivor_entries e JOIN users u ON u.id = e.user_id
            WHERE e.pool_id = $1 ORDER BY e.created_at, e.id
            """,
            pool_id,
        )
    ]
    picks = await conn.fetch(
        "SELECT * FROM survivor_picks WHERE entry_id = ANY($1::int[]) ORDER BY week, slot", [e["id"] for e in entries]
    )
    by_entry: dict[int, list[dict]] = {}
    for p in picks:
        by_entry.setdefault(p["entry_id"], []).append(dict(p))
    for e in entries:
        e["picks"] = by_entry.get(e["id"], [])
    return entries


def _label(entry: dict, multi: set[int]) -> str:
    return f"{entry['name']} #{entry['entry_no']}" if entry["user_id"] in multi else entry["name"]


def joinable(pool: dict, week: int, sched: dict[str, dict], now: datetime) -> bool:
    """Open until the start week's first game kicks off."""
    if week > pool["start_week"]:
        return False
    if week < pool["start_week"]:
        return True
    kickoffs = [g["kickoff"] for g in sched.values() if g["kickoff"]]
    return not kickoffs or min(kickoffs) > now


def pool_summary(pool: dict, entries: list[dict], user_id: int, week: int, sched: dict[str, dict], now: datetime) -> dict:
    """The hub's card: who's alive and where the caller's entries stand."""
    alive = [e for e in entries if e["eliminated_week"] is None]
    mine = []
    for e in entries:
        if e["user_id"] != user_id:
            continue
        st = status(pool, e, e["picks"])
        this_week = [p for p in e["picks"] if p["week"] == week]
        mine.append({
            "entry_id": e["id"], "entry_no": e["entry_no"], "alive": st["eliminated_week"] is None,
            "lives_left": st["lives_left"], "lives_total": st["lives_total"], "eliminated_week": st["eliminated_week"],
            "picks": [_pick_view(p, sched, now, True) for p in this_week],
            "needs_pick": st["eliminated_week"] is None and week >= pool["start_week"] and len(this_week) < slots(pool, week),
        })
    return {
        **_pool_view(pool),
        "week": week, "entries": len(entries), "alive": len(alive), "mine": mine,
        "winners": winners(pool, entries),
        "can_add_entry": joinable(pool, week, sched, now) and len(mine) < pool["max_entries"],
    }


def _pool_view(pool: dict) -> dict:
    return {
        "id": pool["id"], "name": pool["name"], "season": pool["season"],
        "league_id": pool["league_id"], "league_name": pool.get("league_name"),
        "join_code": pool["join_code"], "start_week": pool["start_week"], "lives": pool["lives"],
        "tie_counts_as": pool["tie_counts_as"], "buyback_until_week": pool["buyback_until_week"],
        "double_from_week": pool["double_from_week"], "missed_pick": pool["missed_pick"],
        "max_entries": pool["max_entries"], "prize_note": pool["prize_note"], "created_by": pool["created_by"],
    }


def winners(pool: dict, entries: list[dict]) -> list[str]:
    """Last one standing; if the last few went out the same week, all of
    them. Empty while two or more are alive, or with one entry."""
    if len(entries) < 2:
        return []
    alive = [e for e in entries if e["eliminated_week"] is None]
    multi = _multi(entries)
    if len(alive) == 1:
        return [_label(alive[0], multi)] if any(e["eliminated_week"] for e in entries) else []
    if alive:
        return []
    last = max(e["eliminated_week"] for e in entries)
    return [_label(e, multi) for e in entries if e["eliminated_week"] == last]


def _multi(entries: list[dict]) -> set[int]:
    seen, multi = set(), set()
    for e in entries:
        (multi if e["user_id"] in seen else seen).add(e["user_id"])
    return multi


def _pick_view(p: dict, sched: dict[str, dict] | None, now: datetime, reveal: bool) -> dict:
    is_locked = p["result"] is not None or (p["kickoff"] is not None and p["kickoff"] <= now)
    if not reveal and not is_locked:
        return {"week": p["week"], "slot": p["slot"], "hidden": True}
    game = (sched or {}).get(p["team"]) if p["team"] else None
    return {
        "week": p["week"], "slot": p["slot"], "team": p["team"], "auto": p["auto"], "result": p["result"],
        "locked": is_locked, "kickoff": p["kickoff"].isoformat() if p["kickoff"] else None,
        "opponent": game["opponent"] if game else None, "home": game["home"] if game else None,
    }


def field(pool: dict, entries: list[dict], user_id: int, week: int, now: datetime) -> dict:
    """The standings: every entry with its lives and picks (others'
    picks for a game that hasn't started stay hidden), plus how the
    pool picked each week that's been revealed."""
    multi = _multi(entries)
    rows = []
    for e in entries:
        st = status(pool, e, e["picks"])
        mine = e["user_id"] == user_id
        this_week = [p for p in e["picks"] if p["week"] == week]
        rows.append({
            "entry_id": e["id"], "name": _label(e, multi), "mine": mine, "lives_left": st["lives_left"],
            "eliminated_week": st["eliminated_week"], "bought_back": e["bought_back"],
            "picks": [_pick_view(p, None, now, mine) for p in e["picks"]],
            "picked_this_week": len(this_week) >= slots(pool, week),
        })
    rows.sort(key=lambda r: (r["eliminated_week"] is not None, -(r["eliminated_week"] or 0), -r["lives_left"], r["name"].lower()))
    popularity: dict[int, dict[str, dict]] = {}
    for e in entries:
        for p in e["picks"]:
            if p["team"] and p["kickoff"] is not None and p["kickoff"] <= now:
                cell = popularity.setdefault(p["week"], {}).setdefault(p["team"], {"team": p["team"], "count": 0, "result": p["result"]})
                cell["count"] += 1
    weeks = {
        w: sorted(teams.values(), key=lambda c: -c["count"]) for w, teams in sorted(popularity.items())
    }
    return {
        "week": week, "rows": rows, "alive": sum(1 for r in rows if r["eliminated_week"] is None),
        "picked": sum(1 for r in rows if r["eliminated_week"] is None and r["picked_this_week"]),
        "popularity": [{"week": w, "teams": t} for w, t in weeks.items()],
        "winners": winners(pool, entries),
    }


async def board(conn, pool: dict, entry: dict, picks: list[dict], season: int, week: int, now: datetime) -> dict:
    """The pick screen: this week's games (both sides), each team's win
    chance and whether it's locked or already used by this entry, plus
    the entry's picks this week."""
    sched = await week_schedule(season, week)
    chances = await win_chances(conn, season, week, sched)
    used = {p["team"]: p["week"] for p in picks if p["team"] and p["week"] != week}
    games: dict[str, dict] = {}
    for team, g in sched.items():
        game = games.setdefault(g["game"], {"id": g["game"], "kickoff": g["kickoff"].isoformat() if g["kickoff"] else None,
                                            "locked": locked(g, now), "teams": []})
        game["teams"].append({
            "team": team, "opponent": g["opponent"], "home": g["home"], "win_pct": chances.get(team),
            "used_week": used.get(team), "locked": locked(g, now),
        })
    for game in games.values():
        game["teams"].sort(key=lambda t: t["home"])
    st = status(pool, entry, picks)
    playing = set(sched)
    return {
        "week": week, "slots": slots(pool, week), "lives_left": st["lives_left"], "lives_total": st["lives_total"],
        "eliminated_week": st["eliminated_week"],
        "games": sorted(games.values(), key=lambda g: (g["kickoff"] or "", g["id"])),
        "byes": sorted(t for t in _ALL_TEAMS if t not in playing),
        "picks": [_pick_view(p, sched, now, True) for p in picks if p["week"] == week],
        "used": [{"team": t, "week": w} for t, w in sorted(used.items(), key=lambda x: x[1])],
        "can_buy_back": can_buy_back(pool, entry, st, week),
        "deadline": (d.isoformat() if (d := sunday_deadline(sched)) else None),
    }


_ALL_TEAMS = (
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WSH",
)


def can_buy_back(pool: dict, entry: dict, st: dict, week: int) -> bool:
    return (
        st["eliminated_week"] is not None and not entry["bought_back"]
        and pool["buyback_until_week"] is not None and week <= pool["buyback_until_week"]
    )


async def planner(conn, pool: dict, picks: list[dict], season: int, week: int) -> dict:
    """The teams this entry hasn't used, by week from now to week 18:
    win chance, or a bye."""
    used = {p["team"] for p in picks if p["team"]}
    weeks = list(range(max(week, pool["start_week"]), LAST_WEEK + 1))
    table: dict[str, list] = {t: [] for t in _ALL_TEAMS if t not in used}
    for w in weeks:
        sched = await week_schedule(season, w)
        chances = await win_chances(conn, season, w, sched)
        for team, cells in table.items():
            g = sched.get(team)
            cells.append(None if g is None else {"opponent": g["opponent"], "home": g["home"], "win_pct": chances.get(team)})
    rows = [{"team": t, "weeks": cells} for t, cells in table.items()]
    rows.sort(key=lambda r: -max((c["win_pct"] or 0) for c in r["weeks"] if c) if any(r["weeks"]) else 0)
    return {"weeks": weeks, "double_weeks": [w for w in weeks if slots(pool, w) == 2], "rows": rows}


# ---- writes ---------------------------------------------------------------

class PickError(Exception):
    pass


async def set_picks(conn, pool: dict, entry: dict, season: int, week: int, teams: list[str], now: datetime) -> None:
    """Replace this week's picks. A pick whose game has started stays
    (it must be in `teams`); every new team's game must not have
    started, and the entry can't have used it in another week."""
    teams = [team_code(t.upper()) for t in teams]
    if len(set(teams)) != len(teams):
        raise PickError("Pick each team once")
    picks = [dict(r) for r in await conn.fetch("SELECT * FROM survivor_picks WHERE entry_id = $1", entry["id"])]
    st = status(pool, entry, picks)
    if st["eliminated_week"] is not None:
        raise PickError("This entry is out")
    if week < pool["start_week"]:
        raise PickError(f"This pool starts in week {pool['start_week']}")
    need = slots(pool, week)
    if len(teams) > need:
        raise PickError(f"Week {week} takes {need} pick{'s' if need > 1 else ''}")
    sched = await week_schedule(season, week)
    this_week = {p["slot"]: p for p in picks if p["week"] == week}
    kept = {s: p for s, p in this_week.items() if p["team"] is None or (p["kickoff"] is not None and p["kickoff"] <= now)}
    for p in kept.values():
        if p["team"] and p["team"] not in teams:
            raise PickError(f"{p['team']} already kicked off, so that pick is locked")
    used = {p["team"]: p["week"] for p in picks if p["team"] and p["week"] != week}
    new = [t for t in teams if t not in {p["team"] for p in kept.values()}]
    games_taken = {sched[p["team"]]["game"] for p in kept.values() if p["team"] in sched}
    for t in new:
        g = sched.get(t)
        if g is None:
            raise PickError(f"{t} doesn't play in week {week}")
        if t in used:
            raise PickError(f"You already used {t} in week {used[t]}")
        if locked(g, now):
            raise PickError(f"{t}'s game has already started")
        if g["game"] in games_taken:
            raise PickError("Your two picks can't be in the same game")
        games_taken.add(g["game"])
    free_slots = [s for s in range(1, need + 1) if s not in kept]
    await conn.execute(
        "DELETE FROM survivor_picks WHERE entry_id = $1 AND week = $2 AND NOT (slot = ANY($3::int[]))",
        entry["id"], week, list(kept),
    )
    for slot, team in zip(free_slots, new):
        await conn.execute(
            "INSERT INTO survivor_picks (entry_id, week, slot, team, kickoff) VALUES ($1, $2, $3, $4, $5)",
            entry["id"], week, slot, team, sched[team]["kickoff"],
        )


async def buy_back(conn, pool: dict, entry: dict, week: int) -> None:
    picks = [dict(r) for r in await conn.fetch("SELECT * FROM survivor_picks WHERE entry_id = $1", entry["id"])]
    st = status(pool, entry, picks)
    if not can_buy_back(pool, entry, st, week):
        raise PickError("Buyback isn't open for this entry")
    await conn.execute("UPDATE survivor_entries SET bought_back = TRUE, eliminated_week = NULL WHERE id = $1", entry["id"])


# ---- the scheduler's job ------------------------------------------------

async def refresh_entry(conn, pool: dict, entry_id: int) -> None:
    entry = dict(await conn.fetchrow("SELECT * FROM survivor_entries WHERE id = $1", entry_id))
    picks = [dict(r) for r in await conn.fetch("SELECT * FROM survivor_picks WHERE entry_id = $1", entry_id)]
    out = status(pool, entry, picks)["eliminated_week"]
    if out != entry["eliminated_week"]:
        await conn.execute("UPDATE survivor_entries SET eliminated_week = $2 WHERE id = $1", entry_id, out)


def best_picks(sched: dict, chances: dict, picks: list[dict], week: int, need: int, now: datetime) -> list[tuple[int, str]]:
    """[(slot, team)] filling the week's open slots with the biggest
    favorites the entry hasn't used and whose games haven't started, never
    two in one game. The auto-pick and the reminder's "Pick best odds"."""
    have = [p for p in picks if p["week"] == week]
    used = {p["team"] for p in picks if p["team"]}
    games_taken = {sched[p["team"]]["game"] for p in have if p["team"] in sched}
    options = sorted(
        (t for t, g in sched.items() if t not in used and not locked(g, now) and g["game"] not in games_taken),
        key=lambda t: -(chances.get(t) or 0),
    )
    out = []
    for slot in [s for s in range(1, need + 1) if s not in {p["slot"] for p in have}]:
        pick = next((t for t in options if sched[t]["game"] not in games_taken), None)
        if pick is None:
            break
        games_taken.add(sched[pick]["game"])
        out.append((slot, pick))
    return out


async def run(conn, season: int, now: datetime | None = None) -> dict:
    """Grade finished games, make missed picks, and score weeks that are
    over. Returns counts, for the log."""
    now = now or datetime.now(UTC)
    week = await current_week(season)
    pools = {r["id"]: dict(r) for r in await conn.fetch("SELECT * FROM survivor_pools WHERE season = $1", season)}
    if not pools:
        return {"graded": 0, "auto": 0, "missed": 0}
    touched: set[tuple[int, int]] = set()
    graded = auto = missed = 0
    # 1. Grade every open pick whose game is final.
    open_picks = await conn.fetch(
        """
        SELECT sp.id, sp.week, sp.team, e.id AS entry_id, e.pool_id
        FROM survivor_picks sp JOIN survivor_entries e ON e.id = sp.entry_id
        JOIN survivor_pools p ON p.id = e.pool_id
        WHERE p.season = $1 AND sp.result IS NULL AND sp.team IS NOT NULL AND sp.week <= $2
        """,
        season, week,
    )
    scheds: dict[int, dict] = {}
    for p in open_picks:
        if p["week"] not in scheds:
            scheds[p["week"]] = await week_schedule(season, p["week"])
        result = grade(p["team"], scheds[p["week"]].get(p["team"]))
        if result:
            await conn.execute("UPDATE survivor_picks SET result = $2, updated_at = now() WHERE id = $1", p["id"], result)
            touched.add((p["pool_id"], p["entry_id"]))
            graded += 1
    # 2. Missed picks: made for the entry before the Sunday deadline, or
    #    a loss once the week is over.
    for w in {week, week - 1}:
        if w < 1:
            continue
        sched = scheds.get(w) or await week_schedule(season, w)
        scheds[w] = sched
        if not sched:
            continue
        deadline = sunday_deadline(sched)
        over = all(g["final"] for g in sched.values())
        chances = None
        for pool in pools.values():
            if w < pool["start_week"]:
                continue
            need = slots(pool, w)
            for e in await conn.fetch(
                "SELECT * FROM survivor_entries WHERE pool_id = $1 AND eliminated_week IS NULL", pool["id"]
            ):
                entry = dict(e)
                picks = [dict(r) for r in await conn.fetch("SELECT * FROM survivor_picks WHERE entry_id = $1", entry["id"])]
                have = [p for p in picks if p["week"] == w]
                if len(have) >= need or entry["created_at"] > (deadline or now):
                    continue
                taken = {p["slot"] for p in have}
                free = [s for s in range(1, need + 1) if s not in taken]
                if pool["missed_pick"] == "auto" and deadline and now >= deadline - AUTO_LEAD and not over:
                    if chances is None:
                        chances = await win_chances(conn, season, w, sched)
                    for slot, pick in best_picks(sched, chances, picks, w, need, now):
                        await conn.execute(
                            "INSERT INTO survivor_picks (entry_id, week, slot, team, kickoff, auto) VALUES ($1, $2, $3, $4, $5, TRUE)",
                            entry["id"], w, slot, pick, sched[pick]["kickoff"],
                        )
                        free = [s for s in free if s != slot]
                        auto += 1
                if over and free:
                    for slot in free:
                        await conn.execute(
                            "INSERT INTO survivor_picks (entry_id, week, slot, team, result) VALUES ($1, $2, $3, NULL, 'missed')",
                            entry["id"], w, slot,
                        )
                        missed += 1
                    touched.add((pool["id"], entry["id"]))
    for pool_id, entry_id in touched:
        await refresh_entry(conn, pools[pool_id], entry_id)
    return {"graded": graded, "auto": auto, "missed": missed}


async def due_reminders(conn, season: int, now: datetime | None = None, can_send=None) -> list[dict]:
    """[{user_id, entry_id, pool_id, pool_name, week, kind, hours, lock}]
    for alive entries still missing a pick inside a reminder window (3
    hours before the week's first kickoff, 2 before the Sunday deadline),
    each once. Marks them sent. `can_send(user_id)`, when given, can say
    not yet (quiet hours): that one isn't marked, so a later run still
    reminds them if the window is open and they still haven't picked."""
    now = now or datetime.now(UTC)
    week = await current_week(season)
    sched = await week_schedule(season, week)
    kickoffs = sorted(g["kickoff"] for g in sched.values() if g["kickoff"])
    if not kickoffs:
        return []
    marks = {"first": kickoffs[0], "sunday": sunday_deadline(sched)}
    out = []
    # When both windows are open at once (the first kickoff is the
    # Sunday deadline), one push covers both.
    reminded: set[int] = set()
    for kind, at in marks.items():
        if at is None or not (at - REMINDERS[kind] <= now < at):
            continue
        rows = await conn.fetch(
            """
            SELECT e.id AS entry_id, e.user_id, e.pool_id, p.name AS pool_name, p.double_from_week, p.start_week,
                   (SELECT count(*) FROM survivor_picks sp WHERE sp.entry_id = e.id AND sp.week = $2) AS picked
            FROM survivor_entries e JOIN survivor_pools p ON p.id = e.pool_id
            WHERE p.season = $1 AND e.eliminated_week IS NULL AND p.start_week <= $2
              AND NOT EXISTS (SELECT 1 FROM survivor_reminders r WHERE r.entry_id = e.id AND r.week = $2 AND r.kind = $3)
            ORDER BY e.id
            """,
            season, week, kind,
        )
        for r in rows:
            if r["picked"] >= slots(dict(r), week):
                continue
            if can_send is not None and r["entry_id"] not in reminded and not await can_send(r["user_id"]):
                continue
            await conn.execute(
                "INSERT INTO survivor_reminders (entry_id, week, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                r["entry_id"], week, kind,
            )
            if r["entry_id"] in reminded:
                continue
            reminded.add(r["entry_id"])
            out.append({
                "user_id": r["user_id"], "entry_id": r["entry_id"], "pool_id": r["pool_id"], "pool_name": r["pool_name"],
                "week": week, "kind": kind, "hours": max(1, round((at - now).total_seconds() / 3600)), "lock": at,
            })
    return out
