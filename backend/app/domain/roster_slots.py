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
# Same real shape frontend/src/components/commissioner/RosterSlotsSection.tsx's
# own DEFAULT_ROSTER_SLOTS uses — the fallback app/queries/draft.py's
# upsert_position_max_setting inserts roster_slots as when a
# commissioner sets position_max before ever staging a roster shape
# (league_roster_slots_settings.roster_slots is NOT NULL, so a bare
# position_max upsert still needs some real value on first insert; the
# ON CONFLICT clause never touches roster_slots on a later run, so a
# real staged value always wins once one exists).
DEFAULT_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7, "IR": 1}

POSITION_TO_SLOT_LABEL = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "DEF": "D/ST", "DL": "DL", "LB": "LB", "DB": "DB"}
FLEX_ELIGIBLE_POSITIONS = {"RB", "WR", "TE"}
FLEX_SLOT_LABEL = "RB/WR/TE"
# League formats (2026-10, app/domain/league_format.py): Superflex is a
# flex that also takes a QB; IDP leagues start individual defenders in
# DL/LB/DB slots plus an IDP flex.
SUPERFLEX_SLOT_LABEL = "QB/RB/WR/TE"
SUPERFLEX_ELIGIBLE_POSITIONS = {"QB", "RB", "WR", "TE"}
IDP_FLEX_SLOT_LABEL = "IDP"
IDP_POSITIONS = {"DL", "LB", "DB"}
BENCH_SLOT_LABEL = "BE"
IR_SLOT_LABEL = "IR"
TAXI_SLOT_LABEL = "TAXI"
# Slots any of several positions can fill.
MULTI_POSITION_SLOTS = {
    FLEX_SLOT_LABEL: FLEX_ELIGIBLE_POSITIONS,
    SUPERFLEX_SLOT_LABEL: SUPERFLEX_ELIGIBLE_POSITIONS,
    IDP_FLEX_SLOT_LABEL: IDP_POSITIONS,
}
_STARTER_SLOTS = ("QB", "RB", "WR", "TE", FLEX_SLOT_LABEL, SUPERFLEX_SLOT_LABEL, "D/ST", "K", "DL", "LB", "DB", IDP_FLEX_SLOT_LABEL)
STARTER_SLOTS = _STARTER_SLOTS

# Sleeper's raw defensive positions -> the IDP group a league starts
# them in (DE/DT/NT play DL, every linebacker LB, corners and safeties DB).
_IDP_GROUP = {
    "DL": "DL", "DE": "DL", "DT": "DL", "NT": "DL",
    "LB": "LB", "ILB": "LB", "OLB": "LB", "MLB": "LB",
    "DB": "DB", "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB",
}


def fantasy_position(position: str | None) -> str | None:
    """A player's position as lineups see it: offense unchanged, a
    defender folded into DL / LB / DB."""
    if position is None:
        return None
    return _IDP_GROUP.get(position, position)

# Sleeper's own `injury_status` values (this league's real player data
# source — see app/providers/sleeper/ingest.py) that mean a player is
# out long enough to stash on IR, matching how every competitor
# researched in the competitive audit gates its IR slot (a real
# designation required, not "any bench player"). "Questionable" and
# "Doubtful" are deliberately excluded — those players are still
# expected to potentially play this week.
IR_ELIGIBLE_INJURY_STATUSES = {"IR", "PUP", "OUT", "NA", "COV", "DNR"}


# Taxi squad (dynasty leagues, 2026-10): a first- or second-year player.
TAXI_MAX_YEARS_EXP = 1


def is_eligible_for_slot(
    position: str, slot_label: str, injury_status: str | None = None, years_exp: int | None = None,
) -> bool:
    """Whether a player at `position` (QB/RB/WR/TE/K/DEF), currently
    carrying `injury_status` (Sleeper's raw string, e.g. "Out"/"IR"/
    "Questionable"/None), can occupy `slot_label` (QB/RB/WR/TE/
    RB-WR-TE/D-ST/K/BE/IR). Bench accepts anyone — a real roster spot
    with no position restriction. IR requires a real injury
    designation — unlike bench, it's not just "any player of the
    right position minus one slot count."""
    if slot_label == BENCH_SLOT_LABEL:
        return True
    if slot_label == IR_SLOT_LABEL:
        return bool(injury_status) and injury_status.strip().upper() in IR_ELIGIBLE_INJURY_STATUSES
    if slot_label == TAXI_SLOT_LABEL:
        return years_exp is not None and years_exp <= TAXI_MAX_YEARS_EXP
    position = fantasy_position(position)
    if slot_label in MULTI_POSITION_SLOTS:
        return position in MULTI_POSITION_SLOTS[slot_label]
    return POSITION_TO_SLOT_LABEL.get(position) == slot_label


def total_draftable_slots(roster_slots: dict[str, int]) -> int:
    """Bench + every starter slot, excluding IR — IR is never filled by
    the initial draft or ordinary roster moves in this league (this
    league's real rule, confirmed by the owner's ESPN scoring
    screenshots: IR is filled later via waivers, out of scope here)."""
    return sum(roster_slots.get(s, 0) for s in _STARTER_SLOTS) + roster_slots.get(BENCH_SLOT_LABEL, 0)
