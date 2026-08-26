"""
Pure autopick logic for the real-time draft (app/domain/draft_engine.py
calls this when a team's pick clock expires — see project plan Phase B).
No DB access, no network — fully unit-testable against plain lists.

This app has no player rankings of its own, so "best available" means
Sleeper's own search_rank (a rough overall-rank proxy, lower is better —
see app/providers/sleeper/). The algorithm is deliberately simple: fill
the fixed starting-slot priority order for this league's real roster
shape (1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K, then bench), taking
the best-ranked available player eligible for whichever slot is still
open, falling back to best-overall once every starting slot is filled.
"""
from app.domain.roster_slots import FLEX_ELIGIBLE_POSITIONS, FLEX_SLOT_LABEL, POSITION_TO_SLOT_LABEL


def _next_needed_slot(rostered_positions: list[str], roster_slots: dict[str, int]) -> str | None:
    """rostered_positions is this team's players' real positions
    (QB/RB/WR/TE/K/DEF), roster_slots is the starting-lineup shape
    (e.g. {"QB":1,"RB":2,"WR":2,"TE":1,"RB/WR/TE":1,"D/ST":1,"K":1,"BE":7}).
    Returns the slot label still needing a player, in fixed priority
    order, or None if every slot (including bench) is full."""
    counts = {"QB": 0, "RB": 0, "WR": 0, "TE": 0, "D/ST": 0, "K": 0}
    for pos in rostered_positions:
        label = POSITION_TO_SLOT_LABEL.get(pos)
        if label in counts:
            counts[label] += 1

    for exact_slot in ("QB", "RB", "WR", "TE"):
        required = roster_slots.get(exact_slot, 0)
        if counts[exact_slot] < required:
            return exact_slot

    flex_required = roster_slots.get(FLEX_SLOT_LABEL, 0)
    flex_used = max(0, counts["RB"] - roster_slots.get("RB", 0)) \
        + max(0, counts["WR"] - roster_slots.get("WR", 0)) \
        + max(0, counts["TE"] - roster_slots.get("TE", 0))
    if flex_used < flex_required:
        return FLEX_SLOT_LABEL

    for exact_slot in ("D/ST", "K"):
        required = roster_slots.get(exact_slot, 0)
        if counts[exact_slot] < required:
            return exact_slot

    bench_required = roster_slots.get("BE", 0)
    starters_required = sum(roster_slots.get(s, 0) for s in ("QB", "RB", "WR", "TE", FLEX_SLOT_LABEL, "D/ST", "K"))
    if len(rostered_positions) < starters_required + bench_required:
        return "BE"

    return None


def choose_autopick(
    rostered_positions: list[str], roster_slots: dict[str, int], available_players: list[dict]
) -> dict | None:
    """available_players: list of {"sleeper_player_id", "position",
    "search_rank"}, already filtered to undrafted/draftable and sorted
    by search_rank ascending (None/unranked last — caller's
    responsibility, see draft_engine.py's query). Returns the chosen
    player dict, or None if nothing is available (shouldn't happen in
    practice — the draft pool is far larger than any one draft)."""
    if not available_players:
        return None

    needed_slot = _next_needed_slot(rostered_positions, roster_slots)

    if needed_slot is None or needed_slot == "BE":
        return available_players[0]  # best overall

    if needed_slot == FLEX_SLOT_LABEL:
        eligible = [p for p in available_players if p["position"] in FLEX_ELIGIBLE_POSITIONS]
    else:
        wanted_position = next(
            (pos for pos, label in POSITION_TO_SLOT_LABEL.items() if label == needed_slot), None
        )
        eligible = [p for p in available_players if p["position"] == wanted_position]

    return eligible[0] if eligible else available_players[0]
