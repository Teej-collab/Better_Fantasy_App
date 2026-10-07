"""
Best ball (league formats, 2026-10): nobody sets a lineup. Every week a
team's score is its best possible lineup from its roster, and its
lineup is re-slotted to show exactly that lineup.

The optimal lineup is greedy, and greedy is exact for this slot shape:
each dedicated slot (QB, RB, …) is filled with that position's top
scorers first, then the flex slots from narrowest to widest (FLEX,
then the IDP flex, then Superflex), each with the best players left
that it can take. Every flex's eligible positions are a superset of the
dedicated slots below it, so no swap between a dedicated slot and a
flex can raise the total.

A player's value is his real points once his game has started, his
projection before (so Sunday morning's lineup is the projected best,
and it settles into the real best as games finish). IR never starts.
"""
from app.domain.roster_slots import (
    BENCH_SLOT_LABEL,
    FLEX_SLOT_LABEL,
    IDP_FLEX_SLOT_LABEL,
    IR_SLOT_LABEL,
    MULTI_POSITION_SLOTS,
    POSITION_TO_SLOT_LABEL,
    STARTER_SLOTS,
    SUPERFLEX_SLOT_LABEL,
    TAXI_SLOT_LABEL,
    fantasy_position,
)

_FLEX_ORDER = (FLEX_SLOT_LABEL, IDP_FLEX_SLOT_LABEL, SUPERFLEX_SLOT_LABEL)


def optimal_lineup(players: list[dict], roster_slots: dict[str, int]) -> dict[str, str]:
    """players: [{"sleeper_player_id", "position", "value", "lineup_slot"}].
    Returns {sleeper_player_id: slot} for every player: the best
    lineup's starters, everyone else on the bench. A player on IR or
    the taxi squad stays where he is."""
    stashed = {p["sleeper_player_id"]: p["lineup_slot"] for p in players if p.get("lineup_slot") in (IR_SLOT_LABEL, TAXI_SLOT_LABEL)}
    pool = sorted(
        (p for p in players if p["sleeper_player_id"] not in stashed),
        key=lambda p: (-(p["value"] or 0), p["sleeper_player_id"]),
    )
    assigned: dict[str, str] = {}

    for slot in STARTER_SLOTS:
        if slot in MULTI_POSITION_SLOTS:
            continue
        for _ in range(roster_slots.get(slot, 0)):
            pick = next(
                (p for p in pool if p["sleeper_player_id"] not in assigned
                 and POSITION_TO_SLOT_LABEL.get(fantasy_position(p["position"])) == slot),
                None,
            )
            if pick:
                assigned[pick["sleeper_player_id"]] = slot

    for slot in _FLEX_ORDER:
        eligible = MULTI_POSITION_SLOTS[slot]
        for _ in range(roster_slots.get(slot, 0)):
            pick = next(
                (p for p in pool if p["sleeper_player_id"] not in assigned and fantasy_position(p["position"]) in eligible),
                None,
            )
            if pick:
                assigned[pick["sleeper_player_id"]] = slot

    return {
        p["sleeper_player_id"]: stashed.get(p["sleeper_player_id"]) or assigned.get(p["sleeper_player_id"], BENCH_SLOT_LABEL)
        for p in players
    }


def best_lineup_points(players: list[dict], roster_slots: dict[str, int]) -> float:
    """The best lineup's total, from each player's `value`."""
    lineup = optimal_lineup(players, roster_slots)
    starters = {pid for pid, slot in lineup.items() if slot not in (BENCH_SLOT_LABEL, IR_SLOT_LABEL, TAXI_SLOT_LABEL)}
    return round(sum(float(p["value"] or 0) for p in players if p["sleeper_player_id"] in starters), 2)


async def reslot_best_ball_lineups(conn, season: int, week: int, league_id: int) -> int:
    """Sets every team's live lineup in a best-ball league to its best
    lineup for `week`. Returns how many players moved."""
    from app.domain.lineup_engine import _get_roster_slots

    roster_slots = await _get_roster_slots(conn, season, league_id)
    rows = await conn.fetch(
        """
        SELECT cr.team_id, cr.sleeper_player_id, cr.lineup_slot, p.position,
               s.fantasy_points AS points,
               COALESCE(proj.projected_points, p.projected_avg_points) AS projected
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        LEFT JOIN player_week_stats s
               ON s.sleeper_player_id = cr.sleeper_player_id AND s.season = $1 AND s.week = $2 AND s.league_id = $3
        LEFT JOIN player_weekly_projections proj
               ON proj.sleeper_player_id = cr.sleeper_player_id AND proj.season = $1 AND proj.week = $2
        WHERE cr.season = $1 AND cr.league_id = $3
        """,
        season, week, league_id,
    )
    by_team: dict[int, list[dict]] = {}
    for r in rows:
        value = r["points"] if r["points"] is not None else r["projected"]
        by_team.setdefault(r["team_id"], []).append(
            {"sleeper_player_id": r["sleeper_player_id"], "position": r["position"],
             "lineup_slot": r["lineup_slot"], "value": float(value) if value is not None else 0.0}
        )
    moves = []
    for team_id, players in by_team.items():
        current = {p["sleeper_player_id"]: p["lineup_slot"] for p in players}
        for pid, slot in optimal_lineup(players, roster_slots).items():
            if current[pid] != slot:
                moves.append((slot, season, team_id, pid))
    if moves:
        await conn.executemany(
            "UPDATE current_rosters SET lineup_slot = $1 WHERE season = $2 AND team_id = $3 AND sleeper_player_id = $4",
            moves,
        )
    return len(moves)
