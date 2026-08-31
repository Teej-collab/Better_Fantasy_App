"""
In-app roster/lineup engine — replaces ESPNLineupClient for everything
under /me/team/* (project plan Phase C). Every mutation here is a plain
`current_rosters` UPDATE/INSERT/DELETE in our own DB, no external call,
no shared-credential problem: this is what actually eliminates the
cross-owner ESPN-write bug that started this whole pivot (see
app/routers/me.py's former CROSS-OWNER CREDENTIAL CAVEAT, now retired
along with ESPNLineupClient).

Roster shape (which slots exist, how many of each) comes from
draft_config.roster_slots for the season — the same config the draft
itself used to build the board, so a team's lineup rules can never
drift from what they actually drafted against.
"""
import json

from app.config import DEFAULT_LEAGUE_ID
from app.domain.lineup_exceptions import (
    AmbiguousDisplacementError,
    PlayerAlreadyRosteredError,
    PlayerNotDraftableError,
    PlayerNotOnRosterError,
    RosterConfigNotFoundError,
    RosterFullError,
    SlotIneligibleError,
)
from app.domain.roster_slots import BENCH_SLOT_LABEL, is_eligible_for_slot, total_draftable_slots

_ROSTER_ENTRY_SQL = """
    SELECT cr.sleeper_player_id, cr.lineup_slot, cr.acquired_via, cr.acquired_at,
           p.full_name AS player_name, p.position, p.pro_team, p.injury_status
    FROM current_rosters cr
    JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
    WHERE cr.season = $1 AND cr.team_id = $2
"""


# Separate from _ROSTER_ENTRY_SQL (not a concatenation of it) since that
# constant's WHERE clause is already baked in before where a JOIN would
# need to go, and every other caller (_get_roster_entry,
# _find_displacement) appends its own WHERE condition onto it — adding
# a week-scoped JOIN there would force an unwanted $3 week param onto
# both of them. LEFT JOIN, not INNER: a player with no computed score
# yet this week (bye, not yet played, scoring not run) should still
# appear on the roster with points=NULL, not be silently dropped —
# same reasoning as app/queries/league.py's get_current_rostered_
# players_by_pro_team.
_ROSTER_ENTRY_WITH_SCORE_SQL = """
    SELECT cr.sleeper_player_id, cr.lineup_slot, cr.acquired_via, cr.acquired_at,
           p.full_name AS player_name, p.position, p.pro_team, p.injury_status,
           pws.fantasy_points AS points
    FROM current_rosters cr
    JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
    LEFT JOIN player_week_stats pws
        ON pws.season = cr.season AND pws.week = $3 AND pws.sleeper_player_id = cr.sleeper_player_id
    WHERE cr.season = $1 AND cr.team_id = $2
    ORDER BY p.position, p.full_name
"""


async def get_roster(conn, season: int, team_id: int, week: int | None = None) -> list[dict]:
    """week is optional and only changes the SELECT shape (adds a
    `points` key) — every caller besides the plain GET /me/team read
    path omits it and gets the exact same rows as before."""
    if week is None:
        rows = await conn.fetch(_ROSTER_ENTRY_SQL + " ORDER BY p.position, p.full_name", season, team_id)
        return [dict(r) for r in rows]
    rows = await conn.fetch(_ROSTER_ENTRY_WITH_SCORE_SQL, season, team_id, week)
    return [dict(r) for r in rows]


async def _get_roster_slots(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict[str, int]:
    raw = await conn.fetchval(
        "SELECT roster_slots FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if raw is None:
        raise RosterConfigNotFoundError(
            f"No draft_config exists for season {season} — the roster shape isn't known yet"
        )
    return json.loads(raw) if isinstance(raw, str) else raw


async def _get_roster_entry(conn, season: int, team_id: int, sleeper_player_id: str) -> dict:
    row = await conn.fetchrow(_ROSTER_ENTRY_SQL + " AND cr.sleeper_player_id = $3", season, team_id, sleeper_player_id)
    if row is None:
        raise PlayerNotOnRosterError(f"{sleeper_player_id} isn't on this roster")
    return dict(row)


async def _find_displacement(conn, season: int, team_id: int, to_slot: str, roster_slots: dict) -> dict | None:
    if to_slot == BENCH_SLOT_LABEL:
        return None  # bench always has room in practice for a single move
    occupants = await conn.fetch(
        _ROSTER_ENTRY_SQL + " AND cr.lineup_slot = $3", season, team_id, to_slot
    )
    capacity = roster_slots.get(to_slot, 0)
    if len(occupants) < capacity:
        return None
    if len(occupants) == 1:
        return dict(occupants[0])
    raise AmbiguousDisplacementError(
        f"Slot {to_slot} is full and has {len(occupants)} current occupants — use a swap instead"
    )


async def plan_move(
    conn, season: int, team_id: int, sleeper_player_id: str, to_slot: str, league_id: int = DEFAULT_LEAGUE_ID
) -> dict:
    """Pure validation, no write — same PREVIEW-ONLY role
    ESPNLineupClient.plan_lineup_change used to play."""
    player = await _get_roster_entry(conn, season, team_id, sleeper_player_id)
    if not is_eligible_for_slot(player["position"], to_slot):
        raise SlotIneligibleError(f"{player['player_name']} ({player['position']}) isn't eligible for slot {to_slot}")
    roster_slots = await _get_roster_slots(conn, season, league_id)
    displaced = await _find_displacement(conn, season, team_id, to_slot, roster_slots)
    return {"player": player, "from_slot": player["lineup_slot"], "to_slot": to_slot, "displaced_player": displaced}


async def plan_swap(conn, season: int, team_id: int, sleeper_player_id_a: str, sleeper_player_id_b: str) -> dict:
    player_a = await _get_roster_entry(conn, season, team_id, sleeper_player_id_a)
    player_b = await _get_roster_entry(conn, season, team_id, sleeper_player_id_b)
    if not is_eligible_for_slot(player_a["position"], player_b["lineup_slot"]):
        raise SlotIneligibleError(f"{player_a['player_name']} isn't eligible for {player_b['player_name']}'s slot")
    if not is_eligible_for_slot(player_b["position"], player_a["lineup_slot"]):
        raise SlotIneligibleError(f"{player_b['player_name']} isn't eligible for {player_a['player_name']}'s slot")
    return {"player_a": player_a, "player_b": player_b}


async def move_player(
    conn, season: int, team_id: int, sleeper_player_id: str, to_slot: str, league_id: int = DEFAULT_LEAGUE_ID
) -> dict:
    async with conn.transaction():
        plan = await plan_move(conn, season, team_id, sleeper_player_id, to_slot, league_id)
        if plan["displaced_player"] is not None:
            await conn.execute(
                "UPDATE current_rosters SET lineup_slot = $1 WHERE season = $2 AND team_id = $3 AND sleeper_player_id = $4",
                BENCH_SLOT_LABEL, season, team_id, plan["displaced_player"]["sleeper_player_id"],
            )
        await conn.execute(
            "UPDATE current_rosters SET lineup_slot = $1 WHERE season = $2 AND team_id = $3 AND sleeper_player_id = $4",
            to_slot, season, team_id, sleeper_player_id,
        )
        return await get_roster(conn, season, team_id)


async def swap_players(conn, season: int, team_id: int, sleeper_player_id_a: str, sleeper_player_id_b: str) -> dict:
    async with conn.transaction():
        plan = await plan_swap(conn, season, team_id, sleeper_player_id_a, sleeper_player_id_b)
        await conn.execute(
            "UPDATE current_rosters SET lineup_slot = $1 WHERE season = $2 AND team_id = $3 AND sleeper_player_id = $4",
            plan["player_b"]["lineup_slot"], season, team_id, sleeper_player_id_a,
        )
        await conn.execute(
            "UPDATE current_rosters SET lineup_slot = $1 WHERE season = $2 AND team_id = $3 AND sleeper_player_id = $4",
            plan["player_a"]["lineup_slot"], season, team_id, sleeper_player_id_b,
        )
        return await get_roster(conn, season, team_id)


async def drop_player(conn, season: int, team_id: int, sleeper_player_id: str) -> list[dict]:
    """Sends a player back to free agency — no drop target, unlike the
    drop-to-make-room path inside add_free_agent. Not gated behind a
    roster-capacity check the way an add is: a team can always have
    fewer players than its roster shape allows, it just can't have
    more."""
    async with conn.transaction():
        await _get_roster_entry(conn, season, team_id, sleeper_player_id)  # raises PlayerNotOnRosterError if not
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            season, team_id, sleeper_player_id,
        )
        return await get_roster(conn, season, team_id)


async def add_free_agent(
    conn, season: int, team_id: int, sleeper_player_id: str, drop_sleeper_player_id: str | None = None,
    league_id: int = DEFAULT_LEAGUE_ID,
) -> dict:
    async with conn.transaction():
        player = await conn.fetchrow(
            "SELECT sleeper_player_id, is_draftable FROM players WHERE sleeper_player_id = $1", sleeper_player_id
        )
        if player is None or not player["is_draftable"]:
            raise PlayerNotDraftableError(f"{sleeper_player_id} isn't a rosterable player")

        already_rostered = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND sleeper_player_id = $2 AND league_id = $3",
            season, sleeper_player_id, league_id,
        )
        if already_rostered:
            raise PlayerAlreadyRosteredError(f"{sleeper_player_id} is already on a roster this season")

        roster_slots = await _get_roster_slots(conn, season, league_id)
        capacity = total_draftable_slots(roster_slots)
        current_count = await conn.fetchval(
            "SELECT count(*) FROM current_rosters WHERE season = $1 AND team_id = $2", season, team_id
        )

        if current_count >= capacity:
            if not drop_sleeper_player_id:
                raise RosterFullError(f"Roster is full ({current_count}/{capacity}) — choose a player to drop")
            dropped = await _get_roster_entry(conn, season, team_id, drop_sleeper_player_id)
            await conn.execute(
                "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
                season, team_id, drop_sleeper_player_id,
            )
        else:
            dropped = None

        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, $4, 'free_agent', $5)",
            season, team_id, sleeper_player_id, BENCH_SLOT_LABEL, league_id,
        )
        return {"roster": await get_roster(conn, season, team_id), "dropped_player": dropped}
