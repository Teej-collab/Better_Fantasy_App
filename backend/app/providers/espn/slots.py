"""
ESPN lineup slot IDs.

VERIFIED (empirically, not from documentation — ESPN publishes none):
this is exactly espn_api's own POSITION_MAP
(.venv/lib/.../espn_api/football/constant.py), the same mapping
app/providers/espn/adapter.py already uses right now to correctly parse
every real roster this league has ever had, including the fact that
this league's actual FLEX slot is labeled "RB/WR/TE" rather than the
generic "FLEX" some other leagues use (see TODO.md's Phase 6 roster-
order fix, which confirmed this against real production data).

That verification covers the READ side only: these are confirmed to be
the IDs ESPN sends back describing where a player currently sits. It is
NOT independently confirmed that a lineup-change *write* request expects
the same integer IDs in the same field name — no public source has ever
shown us a real write request body. Treat this file as reliable for
reading rosters and provisional for writing them. See
ESPN_LINEUP_WRITE.md for the write-side verification status.
"""
from enum import IntEnum

from espn_api.football.constant import POSITION_MAP


class LineupSlot(IntEnum):
    """Only the slot IDs our planning logic needs to reason about
    directly. Every other eligible-slot ID a player can carry (bye-week
    combo slots, individual defensive positions, etc.) is read through
    POSITION_MAP instead of being enumerated here — adding them here
    would just be unused magic numbers."""

    QB = 0
    RB = 2
    WR = 4
    TE = 6
    DST = 16
    K = 17
    BENCH = 20
    IR = 21
    FLEX = 23


def slot_label(slot_id: int) -> str:
    """ESPN's own label for a slot ID, e.g. 23 -> "RB/WR/TE" in this
    league. Falls back to the raw ID (as a string) for any ID espn_api's
    POSITION_MAP doesn't recognize, rather than raising — a label is
    display-only, never used for validation."""
    return POSITION_MAP.get(slot_id, str(slot_id))


# POSITION_MAP's own string-keyed entries are NOT the reverse of its
# int-keyed entries — e.g. it has 20: 'BE' but no 'BE': 20, and
# 23: 'RB/WR/TE' but only 'FLEX': 23 (not 'RB/WR/TE': 23). Confirmed by
# reading the installed espn_api source directly (constant.py); relying
# on POSITION_MAP's own reverse entries would silently fail to recognize
# a bench, IR, or (in this league) flex player's own label. Building the
# reverse map ourselves from the int->label direction instead — that
# half is the one adapter.py already relies on in production, so it's
# the trustworthy source of truth.
_LABEL_TO_ID = {v: k for k, v in POSITION_MAP.items() if isinstance(k, int)}

# Common names a human (or a /setlineup command) would type that don't
# match this league's exact ESPN label string. "FLEX" is the big one:
# ESPN's own API labels flex-eligible slots by their actual eligible
# positions (here "RB/WR/TE"), not the word "FLEX" — but the word
# "FLEX" is what everyone actually says.
_ALIASES = {
    "FLEX": LineupSlot.FLEX,
    "BENCH": LineupSlot.BENCH,
    "BN": LineupSlot.BENCH,
    "DEF": LineupSlot.DST,
    "DEFENSE": LineupSlot.DST,
}


def slot_id_from_label(label: str) -> int | None:
    """Reverse lookup, e.g. "RB" -> 2, "BE" -> 20, "FLEX" -> 23. Returns
    None for an unrecognized label instead of raising — callers decide
    whether that's an error (see lineup_client.py's InvalidSlotError)."""
    if label in _LABEL_TO_ID:
        return _LABEL_TO_ID[label]
    return _ALIASES.get(label.strip().upper())
