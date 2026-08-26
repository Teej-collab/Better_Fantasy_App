"""
Shared position <-> lineup-slot eligibility rules for the in-app roster
system (draft autopick, lineup moves/swaps, free-agent add/drop) — one
place for "what slots can this position fill," instead of every
consumer reimplementing the QB/RB/WR/TE/K/DEF -> QB/RB/WR/TE/RB-WR-TE/
D-ST/K mapping and flex logic separately.

These are this league's own real slot labels (matching its actual ESPN
roster settings — see the project plan's Context section), not an
ESPN-specific vocabulary — app/providers/espn/slots.py's POSITION_MAP
happens to use the same "RB/WR/TE"/"D/ST" strings, which is a
coincidence of this league's config, not a dependency on that module.
"""
POSITION_TO_SLOT_LABEL = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "DEF": "D/ST"}
FLEX_ELIGIBLE_POSITIONS = {"RB", "WR", "TE"}
FLEX_SLOT_LABEL = "RB/WR/TE"
BENCH_SLOT_LABEL = "BE"
_STARTER_SLOTS = ("QB", "RB", "WR", "TE", FLEX_SLOT_LABEL, "D/ST", "K")


def is_eligible_for_slot(position: str, slot_label: str) -> bool:
    """Whether a player at `position` (QB/RB/WR/TE/K/DEF) can occupy
    `slot_label` (QB/RB/WR/TE/RB-WR-TE/D-ST/K/BE). Bench accepts
    anyone — a real roster spot with no position restriction."""
    if slot_label == BENCH_SLOT_LABEL:
        return True
    if slot_label == FLEX_SLOT_LABEL:
        return position in FLEX_ELIGIBLE_POSITIONS
    return POSITION_TO_SLOT_LABEL.get(position) == slot_label


def total_draftable_slots(roster_slots: dict[str, int]) -> int:
    """Bench + every starter slot, excluding IR — IR is never filled by
    the initial draft or ordinary roster moves in this league (this
    league's real rule, confirmed by the owner's ESPN scoring
    screenshots: IR is filled later via waivers, out of scope here)."""
    return sum(roster_slots.get(s, 0) for s in _STARTER_SLOTS) + roster_slots.get(BENCH_SLOT_LABEL, 0)
