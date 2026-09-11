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
    LineupLockedError,
    PlayerAlreadyRosteredError,
    PlayerNotDraftableError,
    PlayerNotOnRosterError,
    PlayerOnWaiversError,
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
#
# 2026-09-10 real production bug, found live: player_week_stats is
# uniquely keyed per (season, week, sleeper_player_id, league_id) — a
# genuinely different row per league once more than one league has run
# its weekly compute for the same real player — but this JOIN never
# filtered on league_id, so once a second league existed, this fanned
# out into TWO matching pws rows per roster entry, doubling every
# player (and, since points get summed downstream in some callers, the
# score) on affected teams' rosters. cr.league_id is exactly the right
# scope: a roster entry's own league. See MIGRATION_MAP-era migration
# 130f4acc3a50 for when player_week_stats actually got widened to
# include league_id — this join was simply never updated to match.
_ROSTER_ENTRY_WITH_SCORE_SQL = """
    SELECT cr.sleeper_player_id, cr.lineup_slot, cr.acquired_via, cr.acquired_at,
           p.full_name AS player_name, p.position, p.pro_team, p.injury_status,
           COALESCE(pwp.projected_points, p.projected_avg_points) AS points_projected,
           pws.fantasy_points AS points
    FROM current_rosters cr
    JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
    LEFT JOIN player_week_stats pws
        ON pws.season = cr.season AND pws.week = $3 AND pws.sleeper_player_id = cr.sleeper_player_id
        AND pws.league_id = cr.league_id
    LEFT JOIN player_weekly_projections pwp
        ON pwp.season = cr.season AND pwp.week = $3 AND pwp.sleeper_player_id = cr.sleeper_player_id
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
    conn, season: int, team_id: int, sleeper_player_id: str, to_slot: str, league_id: int = DEFAULT_LEAGUE_ID,
    locked_pro_teams: frozenset[str] = frozenset(),
) -> dict:
    """Pure validation, no write — same PREVIEW-ONLY role
    ESPNLineupClient.plan_lineup_change used to play. `locked_pro_teams`
    (real NFL team abbreviations whose game has already kicked off this
    week — see app/domain/nfl_schedule.py's locked_pro_teams, computed
    by the caller so this stays a pure-DB function with no network
    call) is empty by default, meaning "no lock enforced" — every real
    caller in app/routers/me.py always passes the live set."""
    player = await _get_roster_entry(conn, season, team_id, sleeper_player_id)
    if not is_eligible_for_slot(player["position"], to_slot, player["injury_status"]):
        raise SlotIneligibleError(f"{player['player_name']} ({player['position']}) isn't eligible for slot {to_slot}")
    if player["pro_team"] in locked_pro_teams:
        raise LineupLockedError(f"{player['player_name']}'s game has already started — their lineup slot is locked")
    roster_slots = await _get_roster_slots(conn, season, league_id)
    displaced = await _find_displacement(conn, season, team_id, to_slot, roster_slots)
    if displaced is not None and displaced["pro_team"] in locked_pro_teams:
        raise LineupLockedError(
            f"{displaced['player_name']}'s game has already started — they can't be benched to make room"
        )
    return {"player": player, "from_slot": player["lineup_slot"], "to_slot": to_slot, "displaced_player": displaced}


async def plan_swap(
    conn, season: int, team_id: int, sleeper_player_id_a: str, sleeper_player_id_b: str,
    locked_pro_teams: frozenset[str] = frozenset(),
) -> dict:
    player_a = await _get_roster_entry(conn, season, team_id, sleeper_player_id_a)
    player_b = await _get_roster_entry(conn, season, team_id, sleeper_player_id_b)
    if not is_eligible_for_slot(player_a["position"], player_b["lineup_slot"], player_a["injury_status"]):
        raise SlotIneligibleError(f"{player_a['player_name']} isn't eligible for {player_b['player_name']}'s slot")
    if not is_eligible_for_slot(player_b["position"], player_a["lineup_slot"], player_b["injury_status"]):
        raise SlotIneligibleError(f"{player_b['player_name']} isn't eligible for {player_a['player_name']}'s slot")
    if player_a["pro_team"] in locked_pro_teams:
        raise LineupLockedError(f"{player_a['player_name']}'s game has already started — their lineup slot is locked")
    if player_b["pro_team"] in locked_pro_teams:
        raise LineupLockedError(f"{player_b['player_name']}'s game has already started — their lineup slot is locked")
    return {"player_a": player_a, "player_b": player_b}


async def move_player(
    conn, season: int, team_id: int, sleeper_player_id: str, to_slot: str, league_id: int = DEFAULT_LEAGUE_ID,
    locked_pro_teams: frozenset[str] = frozenset(),
) -> dict:
    async with conn.transaction():
        plan = await plan_move(conn, season, team_id, sleeper_player_id, to_slot, league_id, locked_pro_teams)
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


async def swap_players(
    conn, season: int, team_id: int, sleeper_player_id_a: str, sleeper_player_id_b: str,
    locked_pro_teams: frozenset[str] = frozenset(),
) -> dict:
    async with conn.transaction():
        plan = await plan_swap(conn, season, team_id, sleeper_player_id_a, sleeper_player_id_b, locked_pro_teams)
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
    league_id: int = DEFAULT_LEAGUE_ID, override_waivers: bool = False,
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

        # A plain table read, not a call into app/domain/waivers.py — that
        # module builds on lineup_engine's own concepts (roster_slots,
        # BENCH_SLOT_LABEL), so importing it back here would be circular.
        # See waivers.py's own docstring for the real "1-day waiver
        # period, resets weekly to inverse standings" rule this enforces.
        # override_waivers skips this check entirely — only
        # commissioner_lineup.py's force-add ever passes True (and only
        # when the commissioner explicitly confirms it, after a first
        # attempt already came back blocked), for exactly the case a
        # real incident surfaced: a bad sync/error forced a drop, and
        # the affected owner had no way to get the player back before
        # the normal 1-day waiver clock ran out.
        if not override_waivers:
            on_waivers = await conn.fetchval(
                "SELECT 1 FROM waiver_wire WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3 AND clears_at > now()",
                season, league_id, sleeper_player_id,
            )
            if on_waivers:
                raise PlayerOnWaiversError(f"{sleeper_player_id} is still on waivers — submit a waiver claim instead")

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
