"""
What a trade is worth (2026-10-23 Trades overhaul): each player's
rest-of-season points a week, from player_weekly_projections (the
same numbers the commissioner's trade review uses), and what a trade
does to a team's best starting lineup.

Two different questions, kept apart on purpose:
- value: points a week coming in minus going out. How fair the trade
  is, the way the other owner will see it too.
- lineup: the team's best starting lineup before and after, slot by
  slot. What the trade actually does for you; a 2-for-1 that "wins" on
  value can still make your lineup worse.

"A week" is the average over the weeks a player is projected to play
(byes left out), from the current week through Week 17.
"""
from app.domain.ir_rules import count_roster_toward_limit
from app.domain.roster_slots import (
    DEFAULT_ROSTER_SLOTS,
    IR_SLOT_LABEL,
    MULTI_POSITION_SLOTS,
    STARTER_SLOTS,
    TAXI_SLOT_LABEL,
    is_eligible_for_slot,
    total_draftable_slots,
)
from app.queries import league as league_queries

LAST_WEEK = 17
# Closer than this (points a week) reads as even.
EVEN_WITHIN = 1.5
# A gap bigger than this gets a "to even it out" suggestion.
SUGGEST_OVER = 3.0
SLOT_NAMES = {"RB/WR/TE": "FLEX", "QB/RB/WR/TE": "SUPERFLEX", "IDP": "IDP FLEX", "D/ST": "D/ST"}


async def current_week(conn, season: int) -> int:
    return await league_queries.get_cached_current_week(conn, season) or 1


async def player_values(conn, season: int, week: int, player_ids: list[str]) -> dict[str, dict]:
    """{player_id: {per_week, pro_team, injury_status, name, position}}."""
    if not player_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT pl.sleeper_player_id, pl.full_name, pl.position, pl.pro_team, pl.injury_status,
               COALESCE(AVG(w.projected_points) FILTER (WHERE w.projected_points > 0), 0) AS per_week
        FROM players pl
        LEFT JOIN player_weekly_projections w
            ON w.sleeper_player_id = pl.sleeper_player_id AND w.season = $1 AND w.week >= $2 AND w.week <= $3
        WHERE pl.sleeper_player_id = ANY($4::text[])
        GROUP BY pl.sleeper_player_id
        """,
        season, week, LAST_WEEK, list(set(player_ids)),
    )
    return {
        r["sleeper_player_id"]: {
            "name": r["full_name"],
            "position": r["position"],
            "pro_team": r["pro_team"],
            "injury_status": r["injury_status"],
            "per_week": round(float(r["per_week"]), 1),
        }
        for r in rows
    }


async def roster_slots(conn, season: int, league_id: int) -> dict:
    """The same roster shape the trade capacity check uses
    (app/domain/trades.py's _get_roster_slots), or the default one."""
    from app.domain.trades import _get_roster_slots  # trades imports this module

    return await _get_roster_slots(conn, season, league_id) or dict(DEFAULT_ROSTER_SLOTS)


async def roster_ids(conn, season: int, team_id: int) -> list[str]:
    return [
        r["sleeper_player_id"]
        for r in await conn.fetch(
            "SELECT sleeper_player_id FROM current_rosters WHERE season = $1 AND team_id = $2", season, team_id
        )
    ]


def best_lineup(players: list[dict], slots: dict) -> list[dict]:
    """Greedy best lineup: single-position slots first, then the flex
    kinds, each taking the highest points-a-week player who fits.
    `players` are dicts with id, position and per_week. Returns
    [{slot, player}] in STARTER_SLOTS order (player None if empty)."""
    pool = sorted(players, key=lambda p: -p["per_week"])
    used: set[str] = set()
    filled: dict[str, list] = {}
    order = [s for s in STARTER_SLOTS if s not in MULTI_POSITION_SLOTS] + [s for s in STARTER_SLOTS if s in MULTI_POSITION_SLOTS]
    for slot in order:
        for _ in range(int(slots.get(slot, 0) or 0)):
            pick = next((p for p in pool if p["id"] not in used and is_eligible_for_slot(p["position"] or "", slot)), None)
            if pick:
                used.add(pick["id"])
            filled.setdefault(slot, []).append(pick)
    return [{"slot": slot, "player": p} for slot in STARTER_SLOTS for p in filled.get(slot, [])]


def _lineup_total(lineup: list[dict]) -> float:
    return sum(e["player"]["per_week"] for e in lineup if e["player"])


def lineup_change(before_players: list[dict], after_players: list[dict], slots: dict) -> dict:
    """Slot-by-slot before → after for one team, only the slots that change."""
    before = best_lineup(before_players, slots)
    after = best_lineup(after_players, slots)
    rows = []
    for b, a in zip(before, after):
        bp, ap = b["player"], a["player"]
        if (bp or {}).get("id") == (ap or {}).get("id"):
            continue
        delta = (ap["per_week"] if ap else 0) - (bp["per_week"] if bp else 0)
        rows.append({
            "slot": SLOT_NAMES.get(b["slot"], b["slot"]),
            "before": bp["name"] if bp else None,
            "after": ap["name"] if ap else None,
            "delta": round(delta, 1),
        })
    return {
        "before": round(_lineup_total(before), 1),
        "after": round(_lineup_total(after), 1),
        "change": round(_lineup_total(after) - _lineup_total(before), 1),
        "slots": rows,
    }


def verdict(value_change: float) -> str:
    if abs(value_change) < EVEN_WITHIN:
        return "even"
    return "you" if value_change > 0 else "them"


async def evaluate(
    conn, season: int, league_id: int, my_team_id: int, their_team_id: int,
    give: list[str], receive: list[str], my_drops: list[str] | None = None,
) -> dict:
    """Everything the builder and an offer screen show, from my side:
    the players with their values, the value gap, my lineup before and
    after, theirs (just the number), how many drops each side needs,
    and a suggestion that would even out a lopsided trade."""
    week = await current_week(conn, season)
    slots = await roster_slots(conn, season, league_id)
    mine = await roster_ids(conn, season, my_team_id)
    theirs = await roster_ids(conn, season, their_team_id)
    values = await player_values(conn, season, week, mine + theirs)
    my_drops = [p for p in (my_drops or []) if p in mine and p not in give]

    def player(pid: str) -> dict:
        v = values.get(pid, {})
        return {"id": pid, "name": v.get("name") or pid, "position": v.get("position"), "per_week": v.get("per_week", 0.0)}

    give_value = sum(player(p)["per_week"] for p in give)
    get_value = sum(player(p)["per_week"] for p in receive)
    value_change = round(get_value - give_value, 1)

    my_after = [p for p in mine if p not in give and p not in my_drops] + list(receive)
    their_after = [p for p in theirs if p not in receive] + list(give)
    mine_lineup = lineup_change([player(p) for p in mine], [player(p) for p in my_after], slots)
    their_lineup = lineup_change([player(p) for p in theirs], [player(p) for p in their_after], slots)

    capacity = total_draftable_slots(slots)
    my_count = await count_roster_toward_limit(conn, season, my_team_id)
    their_count = await count_roster_toward_limit(conn, season, their_team_id)
    my_drops_needed = max(0, my_count + len(receive) - len(give) - capacity)
    their_drops_needed = max(0, their_count + len(give) - len(receive) - capacity)

    suggestion = None
    if give and receive and abs(value_change) > SUGGEST_OVER:
        gap = abs(value_change)
        if value_change > 0:
            candidates = [player(p) for p in mine if p not in give]
            side = "give"
        else:
            candidates = [player(p) for p in theirs if p not in receive]
            side = "receive"
        candidates = [c for c in candidates if c["per_week"] >= 2]
        if candidates:
            best = min(candidates, key=lambda c: abs(c["per_week"] - gap))
            if abs(best["per_week"] - gap) < gap:
                suggestion = {"side": side, "player": best}

    return {
        "week": week,
        "give": [player(p) for p in give],
        "receive": [player(p) for p in receive],
        "value_change": value_change,
        "verdict": verdict(value_change),
        "my_lineup": mine_lineup,
        "their_lineup_change": their_lineup["change"],
        "my_drops_needed": my_drops_needed,
        "their_drops_needed": their_drops_needed,
        "suggestion": suggestion,
    }


async def drop_candidates(conn, season: int, team_id: int, exclude: list[str]) -> list[dict]:
    """The team's players who could be dropped to make room, least
    valuable first (IR and taxi stashes left out: they don't count
    toward the roster limit)."""
    week = await current_week(conn, season)
    rows = await conn.fetch(
        "SELECT sleeper_player_id FROM current_rosters WHERE season = $1 AND team_id = $2 "
        "AND lineup_slot NOT IN ($3, $4) AND NOT (sleeper_player_id = ANY($5::text[]))",
        season, team_id, IR_SLOT_LABEL, TAXI_SLOT_LABEL, exclude,
    )
    ids = [r["sleeper_player_id"] for r in rows]
    values = await player_values(conn, season, week, ids)
    out = [{"id": pid, **values.get(pid, {"name": pid, "position": None, "per_week": 0.0})} for pid in ids]
    return sorted(out, key=lambda p: p["per_week"])


def summary_for(trade: dict, my_team_id: int, values: dict[str, dict]) -> dict:
    """The one-line value read for a trade in a list: points a week the
    viewer's side gains (or, for a trade between two other teams, which
    side it leans to)."""
    by_team: dict[int, float] = {}
    for a in trade["assets"]:
        by_team[a["to_team_id"]] = by_team.get(a["to_team_id"], 0) + values.get(a["sleeper_player_id"], {}).get("per_week", 0.0)
    proposing = by_team.get(trade["proposing_team_id"], 0.0)
    receiving = by_team.get(trade["receiving_team_id"], 0.0)
    if my_team_id in (trade["proposing_team_id"], trade["receiving_team_id"]):
        mine = proposing if my_team_id == trade["proposing_team_id"] else receiving
        other = receiving if my_team_id == trade["proposing_team_id"] else proposing
        change = round(mine - other, 1)
        return {"value_change": change, "verdict": verdict(change), "leans_team_id": None}
    gap = proposing - receiving
    leans = None if abs(gap) < EVEN_WITHIN else (trade["proposing_team_id"] if gap > 0 else trade["receiving_team_id"])
    return {"value_change": round(abs(gap), 1), "verdict": "even" if leans is None else "leans", "leans_team_id": leans}



# ---- Trade partners (2026-10-23): who's worth calling ------------------------

FIT_POSITIONS = ("QB", "RB", "WR", "TE")
# A backup this good (points a week) is real depth, not just a body.
DEPTH_FLOOR = 8.0


async def partners(conn, season: int, league_id: int, my_team_id: int) -> list[dict]:
    """Every other team, best trade partners for me first: each with
    their record, what they're thin at (starters in the league's bottom
    third at that position) and where they have depth (a backup in the
    league's top third, worth DEPTH_FLOOR+ a week). A team is a fit when
    they're thin where I'm deep, or deep where I'm thin."""
    week = await current_week(conn, season)
    slots = await roster_slots(conn, season, league_id)
    teams = await conn.fetch(
        """
        SELECT t.id AS team_id, t.team_name, o.display_name AS owner_name, o.logo_url
        FROM teams_by_season t JOIN owners o ON o.owner_id = t.owner_id
        WHERE t.league_id = $1 AND t.season = $2
        """,
        league_id, season,
    )
    standings = await league_queries.get_standings(conn, season, league_id)
    rank = {r["team_id"]: (i + 1, r) for i, r in enumerate(standings)}
    rosters: dict[int, list[str]] = {}
    for r in await conn.fetch(
        "SELECT team_id, sleeper_player_id FROM current_rosters cr JOIN teams_by_season t ON t.id = cr.team_id "
        "WHERE t.league_id = $1 AND cr.season = $2",
        league_id, season,
    ):
        rosters.setdefault(r["team_id"], []).append(r["sleeper_player_id"])
    values = await player_values(conn, season, week, [p for ids in rosters.values() for p in ids])

    strength: dict[int, dict[str, float]] = {}
    depth: dict[int, dict[str, float]] = {}
    for t in teams:
        players = [
            {"id": pid, "name": values.get(pid, {}).get("name", pid), "position": values.get(pid, {}).get("position"),
             "per_week": values.get(pid, {}).get("per_week", 0.0)}
            for pid in rosters.get(t["team_id"], [])
        ]
        starters = {e["player"]["id"] for e in best_lineup(players, slots) if e["player"]}
        strength[t["team_id"]] = {
            pos: sum(p["per_week"] for p in players if p["id"] in starters and p["position"] == pos) for pos in FIT_POSITIONS
        }
        depth[t["team_id"]] = {
            pos: max([p["per_week"] for p in players if p["id"] not in starters and p["position"] == pos] or [0.0])
            for pos in FIT_POSITIONS
        }

    n = len(teams)
    third = max(1, n // 3)

    def thin(team_id: int) -> list[str]:
        out = []
        for pos in FIT_POSITIONS:
            order = sorted(strength, key=lambda tid: strength[tid][pos])
            if order.index(team_id) < third:
                out.append((order.index(team_id), pos))
        return [pos for _, pos in sorted(out)][:2]

    def deep(team_id: int) -> list[str]:
        # A weak starter with a decent backup is still thin, never both.
        weak = thin(team_id)
        out = []
        for pos in FIT_POSITIONS:
            if pos in weak:
                continue
            order = sorted(depth, key=lambda tid: -depth[tid][pos])
            if order.index(team_id) < third and depth[team_id][pos] >= DEPTH_FLOOR:
                out.append((order.index(team_id), pos))
        return [pos for _, pos in sorted(out)][:2]

    my_thin, my_deep = (thin(my_team_id), deep(my_team_id)) if my_team_id in strength else ([], [])
    out = []
    for t in teams:
        if t["team_id"] == my_team_id:
            continue
        needs, surplus = thin(t["team_id"]), deep(t["team_id"])
        they_need_mine = [p for p in needs if p in my_deep]
        i_need_theirs = [p for p in surplus if p in my_thin]
        reasons = [f"They need {p}, you're deep there" for p in they_need_mine] + [
            f"They're deep at {p}, you need one" for p in i_need_theirs
        ]
        position, standing = rank.get(t["team_id"], (None, None))
        out.append({
            "team_id": t["team_id"],
            "team_name": t["team_name"],
            "owner_name": t["owner_name"],
            "logo_url": t["logo_url"],
            "wins": standing["wins"] if standing else 0,
            "losses": standing["losses"] if standing else 0,
            "ties": standing["ties"] if standing else 0,
            "rank": position,
            "needs": needs,
            "deep_at": surplus,
            "fit": len(reasons),
            "fit_reason": reasons[0] if reasons else None,
        })
    return sorted(out, key=lambda p: (-p["fit"], p["rank"] or 99))
