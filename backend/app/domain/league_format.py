"""
A league's format (2026-10): what kind of league it is, how matchups
are decided, how it drafts, and the roster shape it starts from —
picked in the Create a League flow (leagues.league_type / matchup_type /
draft_type / roster_preset / type_settings, migration f1a3c5e7b9d2).

Pure definitions plus one read. Everything that behaves differently by
format asks get_league_format() rather than reading the columns itself.
"""
import json

LEAGUE_TYPES = ("redraft", "keeper", "dynasty", "bestball", "guillotine")
MATCHUP_TYPES = ("h2h", "points")
DRAFT_TYPES = ("snake", "auction")
ROSTER_PRESETS = ("standard", "superflex", "2qb", "idp")

# The roster each preset starts from. The commissioner can still adjust
# any count in Commissioner Tools before the draft.
_STANDARD = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7, "IR": 1}
PRESET_ROSTER_SLOTS: dict[str, dict[str, int]] = {
    "standard": dict(_STANDARD),
    "superflex": {**_STANDARD, "QB/RB/WR/TE": 1},
    "2qb": {**_STANDARD, "QB": 2},
    # IDP: the standard offense plus two of each defender group and an
    # IDP flex, with a deeper bench. Keeps the team D/ST.
    "idp": {**_STANDARD, "DL": 2, "LB": 2, "DB": 2, "IDP": 1, "BE": 9},
}

# Each type's own options and their defaults. Values outside the limits
# are clamped, not rejected, so an older client can't wedge creation.
TYPE_SETTING_LIMITS: dict[str, dict[str, tuple[int, int, int]]] = {
    # name: (default, min, max)
    "redraft": {},
    "keeper": {"keepers_per_team": (2, 1, 10)},
    "dynasty": {"rookie_draft_rounds": (4, 1, 10), "taxi_squad_size": (3, 0, 10)},
    "bestball": {"bench_size": (10, 4, 20)},
    "guillotine": {"faab_budget": (1000, 100, 10000)},
}
AUCTION_BUDGET = (200, 50, 1000)


def normalize_type_settings(league_type: str, draft_type: str, raw: dict | None) -> dict:
    """The stored type_settings for a new league: every option this
    type has, defaulted and clamped; plus the auction budget for an
    auction draft."""
    raw = raw or {}
    out: dict[str, int] = {}
    limits = dict(TYPE_SETTING_LIMITS.get(league_type, {}))
    if draft_type == "auction":
        limits["auction_budget"] = AUCTION_BUDGET
    for name, (default, lo, hi) in limits.items():
        value = raw.get(name, default)
        try:
            value = int(value)
        except (TypeError, ValueError):
            value = default
        out[name] = max(lo, min(hi, value))
    return out


def roster_slots_for(roster_preset: str, league_type: str, type_settings: dict) -> dict[str, int]:
    """The starting roster shape for a new league of this format."""
    slots = dict(PRESET_ROSTER_SLOTS.get(roster_preset, _STANDARD))
    if league_type == "bestball":
        slots["BE"] = type_settings.get("bench_size", TYPE_SETTING_LIMITS["bestball"]["bench_size"][0])
        # No IR in best ball: nobody manages a roster after the draft.
        slots["IR"] = 0
    if league_type == "dynasty" and type_settings.get("taxi_squad_size"):
        slots["TAXI"] = type_settings["taxi_squad_size"]
    return slots


DEFAULT_FORMAT = {
    "league_type": "redraft",
    "matchup_type": "h2h",
    "draft_type": "snake",
    "roster_preset": "standard",
    "type_settings": {},
}


def format_from_row(row) -> dict:
    if row is None:
        return dict(DEFAULT_FORMAT)
    settings = row["type_settings"]
    if isinstance(settings, str):
        settings = json.loads(settings)
    return {
        "league_type": row["league_type"],
        "matchup_type": row["matchup_type"],
        "draft_type": row["draft_type"],
        "roster_preset": row["roster_preset"],
        "type_settings": settings or {},
    }


async def get_league_format(conn, league_id: int) -> dict:
    row = await conn.fetchrow(
        "SELECT league_type, matchup_type, draft_type, roster_preset, type_settings FROM leagues WHERE id = $1",
        league_id,
    )
    return format_from_row(row)


def ranks_by_points(fmt: dict) -> bool:
    """Standings rank on total points rather than wins: a total-points
    league, and a guillotine (every surviving team plays the field)."""
    return fmt["matchup_type"] == "points" or fmt["league_type"] == "guillotine"


def lineups_are_automatic(fmt: dict) -> bool:
    return fmt["league_type"] == "bestball"


# What a new league can actually pick today. Everything else shows in
# the Create a League flow as "Coming soon" (GET /leagues/formats), so
# no league is created with a setting that doesn't do anything yet.
# Widened as each format ships.
AVAILABLE: dict[str, tuple[str, ...]] = {
    "league_type": LEAGUE_TYPES,
    "matchup_type": MATCHUP_TYPES,
    "draft_type": DRAFT_TYPES,
    "roster_preset": ROSTER_PRESETS,
}


def unavailable_choice(choices: dict[str, str]) -> str | None:
    """The first picked option that isn't available yet, as the field
    name, or None when every choice can be created."""
    for field, value in choices.items():
        if value not in AVAILABLE[field]:
            return field
    return None


BEST_BALL_LINEUP_MESSAGE = "This is a best ball league: your best lineup is set for you every week."
BEST_BALL_ROSTER_MESSAGE = "This is a best ball league: rosters are set at the draft, with no trades or waivers after it."


async def best_ball_block(conn, league_id: int, kind: str) -> str | None:
    """The message to refuse a lineup move (`kind` "lineup") or a
    roster move — add, drop, claim, trade — (`kind` "roster") with in a
    best-ball league; None anywhere else."""
    if not lineups_are_automatic(await get_league_format(conn, league_id)):
        return None
    return BEST_BALL_LINEUP_MESSAGE if kind == "lineup" else BEST_BALL_ROSTER_MESSAGE


def uses_faab(fmt: dict) -> bool:
    """Waiver claims are bids against a season budget (guillotine)."""
    return fmt["league_type"] == "guillotine"


def faab_budget(fmt: dict) -> int:
    return int(fmt["type_settings"].get("faab_budget", TYPE_SETTING_LIMITS["guillotine"]["faab_budget"][0]))


# Sleeper's raw positions for individual defenders (IDP leagues).
IDP_RAW_POSITIONS = ("DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "DB", "CB", "S", "SS", "FS")
_IDP_GROUPS = {
    "DL": ["DL", "DE", "DT", "NT"],
    "LB": ["LB", "ILB", "OLB", "MLB"],
    "DB": ["DB", "CB", "S", "SS", "FS"],
}


async def extra_draftable_positions(conn, league_id: int) -> list[str]:
    """Positions draftable in this league beyond the offense every
    league drafts (players.is_draftable): individual defenders in an
    IDP league, nothing anywhere else."""
    fmt = await get_league_format(conn, league_id)
    return list(IDP_RAW_POSITIONS) if fmt["roster_preset"] == "idp" else []


def position_filter(position: str) -> list[str]:
    """The raw positions a position filter means: DL/LB/DB cover every
    position grouped under them."""
    return _IDP_GROUPS.get(position, [position])
