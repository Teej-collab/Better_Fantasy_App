"""
Pure autopick logic for the real-time draft (app/domain/draft_engine.py
calls this when a team's pick clock expires — see project plan Phase B).
No DB access, no network — fully unit-testable against plain lists.

This app has no player rankings of its own, so "best available" means
Sleeper's own search_rank (a rough overall-rank proxy, lower is better —
see app/providers/sleeper/). The algorithm is true best-player-available,
matching how ESPN's and Sleeper's own auto-draft actually behave: take
the single best-ranked player on the board, full stop — real-world ADP
already encodes positional scarcity (that's *why* QBs go in round 3+
rather than round 1 despite every roster needing exactly one), so
layering a fixed "fill starting slots in this order" rule on top of it
double-counts that scarcity and produces exactly the wrong result. This
replaces an earlier version that walked a fixed QB-then-RB-then-WR-then-
TE priority order and always returned the first under-filled slot — since
every empty roster starts at zero for all of them, that always picked a
QB first regardless of rank, a real reported bug (2026-09 mock draft
autodrafting QBs in round 1).

The one guardrail: a position this roster has no plausible remaining room
for (more players at that position than every starting slot, flex
allowance, and the full bench combined could ever use) is skipped, so a
fully-automated draft can't end up all one position — every other
position stays eligible the entire draft, same as a human drafting
straight off a big board.
"""
from app.domain.roster_slots import FLEX_ELIGIBLE_POSITIONS, FLEX_SLOT_LABEL, POSITION_TO_SLOT_LABEL


def _position_capacity(position: str, roster_slots: dict[str, int]) -> int:
    """The most players at `position` this roster could ever plausibly
    use: its own starting slot, plus every flex slot (a deliberate
    over-count — flex is shared across RB/WR/TE, but assuming this one
    position alone could fill every flex spot means this guardrail only
    ever fires in a genuinely degenerate case, never a normal one), plus
    the entire bench (bench accepts any position). This is not a model
    of good roster construction — it only exists to stop autopick from
    drafting literally every remaining pick at one position."""
    label = POSITION_TO_SLOT_LABEL.get(position)
    capacity = roster_slots.get(label, 0) if label else 0
    if position in FLEX_ELIGIBLE_POSITIONS:
        capacity += roster_slots.get(FLEX_SLOT_LABEL, 0)
    capacity += roster_slots.get("BE", 0)
    return capacity


def choose_autopick(
    rostered_positions: list[str], roster_slots: dict[str, int], available_players: list[dict]
) -> dict | None:
    """available_players: list of {"sleeper_player_id", "position",
    "search_rank"}, already filtered to undrafted/draftable and sorted
    by search_rank ascending (None/unranked last — caller's
    responsibility, see draft_engine.py's query). Returns the single
    best-available player overall — real best-player-available, not a
    needs-first fill (see module docstring) — filtering out only
    positions this roster has no plausible room left for. Returns None
    if nothing is available (shouldn't happen in practice — the draft
    pool is far larger than any one draft)."""
    if not available_players:
        return None

    counts: dict[str, int] = {}
    for pos in rostered_positions:
        counts[pos] = counts.get(pos, 0) + 1

    eligible = [
        p for p in available_players
        if counts.get(p["position"], 0) < _position_capacity(p["position"], roster_slots)
    ]
    pool = eligible if eligible else available_players
    return pool[0]
