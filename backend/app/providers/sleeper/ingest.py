"""
Filters Sleeper's full NFL player universe down to a clean, draftable
pool and upserts it into the `players` table (see migration
eedfda2cf6fb's docstring for the schema/identity reasoning).

Filtering for is_draftable is deliberately decisive, not a fuzzy
heuristic — see the project plan's Phase A: real fantasy positions,
active roster status, a real pro team, explicit exclusion of practice
squad/IR/PUP/suspended players. DEF entries are special-cased: Sleeper
keys them by team abbreviation instead of a numeric id and leaves their
name fields blank.
"""
import logging

from app.providers.sleeper.client import fetch_all_players
from app.providers.sleeper.teams import team_full_name

logger = logging.getLogger(__name__)

_DRAFTABLE_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}
_EXCLUDED_STATUSES = {
    "Inactive", "Practice Squad", "Injured Reserve", "PUP", "Non Football Injury", "Suspended",
}

# Sleeper and ESPN disagree on exactly one NFL team abbreviation:
# Washington is "WAS" in Sleeper's raw data but "WSH" everywhere ESPN's
# own convention is used in this app (frontend/src/lib/nfl-teams.ts,
# any legacy ESPN-sourced pro_team value, Gamecast's team_abbr fields).
# Confirmed by a real ingestion run returning "WAS" while the
# established frontend team list — already the app-wide convention
# before this pivot — uses "WSH". Left unnormalized, Gamecast's
# fantasy-impact panel would silently show nothing for any Washington
# game (its pro_team query would never match). Normalize at ingestion
# so every table (players.pro_team, and the DEF row's own
# sleeper_player_id) stays on the one convention the rest of the app
# already uses, rather than carrying two spellings for the same team.
_TEAM_ABBR_NORMALIZE = {"WAS": "WSH"}


def _normalize_team_abbr(abbr: str | None) -> str | None:
    if abbr is None:
        return None
    return _TEAM_ABBR_NORMALIZE.get(abbr, abbr)


def _is_draftable(position: str, fantasy_positions: list, status: str | None, pro_team: str | None) -> bool:
    if position not in _DRAFTABLE_POSITIONS:
        return False
    if not fantasy_positions or not (set(fantasy_positions) & _DRAFTABLE_POSITIONS):
        return False
    if not pro_team:
        return False
    if position == "DEF":
        return True  # DEF entries don't carry a normal individual-player status
    if status != "Active":
        return False
    if status in _EXCLUDED_STATUSES:
        return False
    return True


def _normalize(sleeper_id: str, raw: dict) -> dict:
    position = raw.get("position") or ""
    fantasy_positions = raw.get("fantasy_positions") or []
    pro_team = _normalize_team_abbr(raw.get("team"))
    status = raw.get("status")

    if position == "DEF":
        # Real Sleeper data keys DEF entries by team abbreviation (so
        # sleeper_id == pro_team in practice) — normalize this id the
        # same way as pro_team above, so e.g. Washington's DEF row is
        # identified as "WSH" (matching current_rosters/draft_picks
        # references elsewhere) not "WAS". Name is derived from the
        # (already-normalized) pro_team rather than the raw dict key —
        # the raw key is an identity, not guaranteed-abbreviation, and
        # test fixtures need a 'test-' prefixed key regardless (see
        # conftest.py's cleanup convention).
        sleeper_id = _normalize_team_abbr(sleeper_id)
        full_name = team_full_name(pro_team or sleeper_id)
        first_name, last_name = None, None
    else:
        full_name = raw.get("full_name") or f"{raw.get('first_name', '')} {raw.get('last_name', '')}".strip()
        first_name, last_name = raw.get("first_name"), raw.get("last_name")

    return {
        "sleeper_player_id": sleeper_id,
        "espn_player_id": raw.get("espn_id"),
        "full_name": full_name,
        "first_name": first_name,
        "last_name": last_name,
        "position": position,
        "fantasy_positions": fantasy_positions,
        "pro_team": pro_team,
        "status": status,
        "injury_status": raw.get("injury_status"),
        "search_rank": raw.get("search_rank"),
        "is_draftable": _is_draftable(position, fantasy_positions, status, pro_team),
        "age": raw.get("age"),
        "height": _stringify(raw.get("height")),
        "weight": _stringify(raw.get("weight")),
        "jersey_number": _stringify(raw.get("number")),
        "years_exp": raw.get("years_exp"),
    }


def _stringify(value) -> str | None:
    """Sleeper's raw payload isn't consistent about whether height/weight/
    jersey number come back as a string or a number — cast to str for the
    TEXT columns so asyncpg's strict typing doesn't reject an int/float."""
    return None if value is None else str(value)


async def sync_players(pool) -> int:
    """Fetches, filters, and upserts the full Sleeper player universe.
    Returns the number of rows written. Never call more than once a
    day — see client.py's module docstring."""
    raw_players = fetch_all_players()
    rows = [_normalize(sid, raw) for sid, raw in raw_players.items() if raw.get("position")]

    values = [
        (
            row["sleeper_player_id"], row["espn_player_id"], row["full_name"],
            row["first_name"], row["last_name"], row["position"], row["fantasy_positions"],
            row["pro_team"], row["status"], row["injury_status"], row["search_rank"],
            row["is_draftable"], row["age"], row["height"], row["weight"],
            row["jersey_number"], row["years_exp"],
        )
        for row in rows
    ]
    async with pool.acquire() as conn:
        async with conn.transaction():
            # executemany (not a Python-side loop of individual awaited
            # execute() calls) — this is a ~11k-row upsert against a
            # pooled Supabase connection, and asyncpg pipelines
            # executemany's batch instead of round-tripping per row.
            await conn.executemany(
                """
                INSERT INTO players (
                    sleeper_player_id, espn_player_id, full_name, first_name, last_name,
                    position, fantasy_positions, pro_team, status, injury_status,
                    search_rank, is_draftable, age, height, weight, jersey_number, years_exp,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
                ON CONFLICT (sleeper_player_id) DO UPDATE SET
                    espn_player_id = EXCLUDED.espn_player_id,
                    full_name = EXCLUDED.full_name,
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    position = EXCLUDED.position,
                    fantasy_positions = EXCLUDED.fantasy_positions,
                    pro_team = EXCLUDED.pro_team,
                    status = EXCLUDED.status,
                    injury_status = EXCLUDED.injury_status,
                    search_rank = EXCLUDED.search_rank,
                    is_draftable = EXCLUDED.is_draftable,
                    age = EXCLUDED.age,
                    height = EXCLUDED.height,
                    weight = EXCLUDED.weight,
                    jersey_number = EXCLUDED.jersey_number,
                    years_exp = EXCLUDED.years_exp,
                    updated_at = now()
                """,
                values,
            )

    draftable = [r for r in rows if r["is_draftable"]]
    skill_positions = {"QB", "RB", "WR", "TE"}
    draftable_skill = [r for r in draftable if r["position"] in skill_positions]
    missing_espn_id = [r for r in draftable_skill if r["espn_player_id"] is None]
    if draftable_skill:
        missing_pct = 100 * len(missing_espn_id) / len(draftable_skill)
        logger.info(
            "Sleeper player sync: %d total rows, %d draftable (%d active skill-position). "
            "%.1f%% of active skill-position players are missing an espn_id crosswalk.",
            len(rows), len(draftable), len(draftable_skill), missing_pct,
        )
    return len(rows)
