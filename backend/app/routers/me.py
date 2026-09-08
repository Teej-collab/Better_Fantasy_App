"""
Session-aware "my stuff" endpoints — the homepage hero
(app/domain/your_week.py) and My Team (roster + real lineup/free-agent
management). Same cookie-decode pattern as /auth/me (app/routers/auth.py);
kept separate since this is homepage/dashboard data, not identity itself.

/team/lineup/* is backed entirely by our own `current_rosters` table
(app/domain/lineup_engine.py) — this used to go through ESPNLineupClient
(a real write to ESPN's private API), which this app retired once it
became clear a single shared ESPN session can't act on every owner's
behalf (see git history / ESPN_LINEUP_WRITE.md for the full story).
There is no external write anymore for lineup moves, so there's no
credential problem, no dry-run flag, and no cross-owner fallback
message to worry about — a lineup move is just a plain DB UPDATE.

/team/free-agents (GET) and /team/free-agents/add (POST) are
Sleeper-sourced (sleeper_player_id), backed by current_rosters, and
/add is a REAL write — no more preview-only. This used to be a
two-track situation (an OLD, ESPN-sourced, preview-only
/team/free-agents/preview-add fed the public /free-agents browse page,
since the ESPN player_id it used didn't reliably cross-reference to a
sleeper_player_id) — resolved by rebuilding the free-agent browse page
itself on this Sleeper-sourced pool instead (FreeAgentsList.tsx),
retiring the old ESPN-preview path entirely rather than leaving it
around unused.

Every endpoint resolves owner_id (and from it, team_id) from the
session — never trusts a client-supplied team/owner id, same discipline
as keepers.py/settings.py.
"""
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain import lineup_engine
from app.domain.lineup_exceptions import (
    AmbiguousDisplacementError,
    LineupError,
    PlayerAlreadyRosteredError,
    PlayerNotDraftableError,
    PlayerNotOnRosterError,
    RosterConfigNotFoundError,
    RosterFullError,
    SlotIneligibleError,
)
from app.domain.nfl_schedule import schedule_lookup_by_pro_team
from app.domain.your_week import build_your_week
from app.gamecast import service as gamecast_service
from app.gamecast.models import GameStatus
from app.providers.espn.player_info import get_bulk_ownership
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.queries import league as league_queries
from app.routers.lineup_shared import map_lineup_error

router = APIRouter(prefix="/me", tags=["me"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


async def _require_my_team(payload: dict, active_season: int) -> tuple[int, str, int]:
    """Internal team_id (teams_by_season.id — what current_rosters keys
    on), not espn_team_id. Every /me/team/* route needs this instead
    now that nothing here calls ESPN. Also resolves league_id from the
    session (never a client-supplied value — see app/auth/
    league_context.py) and returns it alongside, so callers that need
    it (lineup moves, free-agent adds) don't have to look it up twice."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        team = await conn.fetchrow(
            "SELECT id, team_name FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            active_season, payload["owner_id"], league_id,
        )
    if team is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return team["id"], team["team_name"], league_id


def _map_lineup_error(e: Exception) -> HTTPException:
    if isinstance(e, PlayerNotOnRosterError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, (SlotIneligibleError, AmbiguousDisplacementError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, RosterConfigNotFoundError):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, PlayerNotDraftableError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, PlayerAlreadyRosteredError):
        return HTTPException(status_code=400, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


def _roster_entry_dict(entry: dict) -> dict:
    return {
        "player_id": entry["sleeper_player_id"],
        "player_name": entry["player_name"],
        "lineup_slot": entry["lineup_slot"],
        "position": entry["position"],
        "pro_team": entry["pro_team"],
        "injury_status": entry["injury_status"],
        "acquired_via": entry["acquired_via"],
        # Only present when the caller resolved a current week and
        # attached these (see my_team below) — every other lineup/free-
        # agent endpoint's entries won't have these keys at all, so
        # .get() rather than [] keeps this one shared dict-builder
        # working for both cases. points comes back as a Postgres
        # NUMERIC (Decimal) or None from the LEFT JOIN — cast to float
        # so it's never a mix of the two across rows.
        "points": float(entry["points"]) if entry.get("points") is not None else None,
        # players.projected_avg_points (ESPN's own per-game average —
        # see app/domain/player_projections.py) — only present on the
        # plain GET /team read, same "only present when the caller
        # resolved a current week" shape as points above. A real 2026-09
        # gap: the My Team roster view had no projection at all before
        # this, so an owner setting their lineup couldn't see projected
        # points anywhere on the page.
        "points_projected": (
            float(entry["points_projected"]) if entry.get("points_projected") is not None else None
        ),
        "next_opponent": entry.get("next_opponent"),
        "game_time": entry.get("game_time"),
        "bye_week": entry.get("bye_week"),
        "on_offense": entry.get("on_offense", False),
        "is_redzone": entry.get("is_redzone", False),
    }


@router.get("/week")
async def week(request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        result = await build_your_week(conn, payload["owner_id"], active_season, league_id)

    if result is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return result


# Moved to app/domain/nfl_schedule.py (2026-09) so
# app/domain/matchup_context.py can share the exact same real-scoreboard
# cross-reference for the matchup screen's roster rows instead of a
# second copy of this join — kept as a local alias so every existing
# call site here (_schedule_lookup(...)) didn't need touching.
_schedule_lookup = schedule_lookup_by_pro_team


def _live_status_lookup(games: list) -> dict[str, dict]:
    """pro_team abbreviation -> {on_offense, is_redzone} for every team
    currently playing a real, in-progress NFL game. Not a new data
    source — app.gamecast.service already keeps a free, continuously-
    refreshed in-memory cache of live game state
    (all_cached_states()/LiveGame) for the Gamecast feature; this just
    reads it and cross-references by team abbreviation, the same join
    shape _schedule_lookup already uses. Deliberately excludes
    halftime/scheduled/final — no one is "on offense" when play isn't
    live."""
    lookup: dict[str, dict] = {}
    for game in games:
        if game.status != GameStatus.IN_PROGRESS:
            continue
        for team in (game.home_team, game.away_team):
            lookup[team.abbr] = {
                "on_offense": game.possession_team_abbr == team.abbr,
                "is_redzone": bool(game.is_redzone and game.possession_team_abbr == team.abbr),
            }
    return lookup


def _normalize_week_roster_row(row: dict) -> dict:
    """Reshapes a league_queries.get_roster_for_week row (player_id,
    points_scored — the shape every roster-history/matchup reader
    already uses) into lineup_engine.get_roster's row shape
    (sleeper_player_id, points, acquired_via) so _roster_entry_dict
    below can build the exact same response either way. acquired_via
    isn't tracked by that read path — None there is honest (this is a
    read-only historical/future view, never the edit-lineup UI, so
    "how was this player acquired" has no real use here anyway)."""
    return {
        "sleeper_player_id": row["player_id"],
        "player_name": row["player_name"],
        "lineup_slot": row["lineup_slot"],
        "position": row["position"],
        "pro_team": row["pro_team"],
        "injury_status": row["injury_status"],
        "acquired_via": None,
        "points": row.get("points_scored"),
        "points_projected": row.get("points_projected"),
    }


@router.get("/team")
async def my_team(request: Request, week: int | None = None):
    """week is optional — omitted (or equal to the season's real
    current week) means exactly what this endpoint has always meant:
    the live, editable lineup. Any OTHER week is a read-only view of
    that week's real roster (current_rosters for the live current week,
    a frozen roster_history snapshot for a past week, falling back to
    live current_rosters for a future one — see
    league_queries.get_roster_for_week) — 2026-09, matching the
    reference ESPN app's own My Team tab, which lets you page through
    real week-specific projections without leaving the roster screen.
    is_editable in the response tells the frontend whether to show the
    edit-lineup affordances at all: lineup_engine's mutation endpoints
    (move/swap/drop) have no week concept whatsoever (see that module)
    — they always act on the single live current_rosters row set, so
    editing while "looking at" a non-current week would silently apply
    to the wrong week. The frontend must hide those controls whenever
    is_editable is false; this endpoint can't enforce that itself since
    the mutation endpoints are separate calls."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, team_name, league_id = await _require_my_team(payload, active_season)

    pool = await get_pool()
    async with pool.acquire() as conn:
        # None pre-draft/pre-season (nothing synced yet) — get_roster
        # falls back to its no-score shape in that case, same as before
        # this endpoint knew about weeks at all.
        current_week = await league_queries.get_cached_current_week(conn, active_season)
        requested_week = week if week is not None else current_week
        is_editable = current_week is None or requested_week == current_week

        if is_editable:
            roster = await lineup_engine.get_roster(conn, active_season, team_id, requested_week)
        else:
            raw_roster = await league_queries.get_roster_for_week(conn, active_season, team_id, requested_week)
            roster = [_normalize_week_roster_row(r) for r in raw_roster]

        bye_weeks = await league_queries.get_bye_weeks(conn, active_season)
        # Per-slot capacity (e.g. RB: 2, WR: 2) — the edit-lineup UI
        # needs this to know how many occupants a slot can hold, not
        # just who's in it right now (a slot can be under-filled right
        # after a draft). None pre-draft, same as roster itself being
        # empty then; MyTeamApp.tsx's own empty-roster case already
        # short-circuits before this would matter.
        raw_roster_slots = await conn.fetchval(
            "SELECT roster_slots FROM draft_config WHERE season = $1 AND league_id = $2", active_season, league_id
        )
        roster_slots = (
            json.loads(raw_roster_slots) if isinstance(raw_roster_slots, str) else raw_roster_slots
        )

    for entry in roster:
        bye_week = bye_weeks.get(entry["pro_team"])
        if bye_week is not None:
            entry["bye_week"] = bye_week

    if requested_week is not None:
        try:
            games = await get_week_scoreboard(requested_week, active_season)
        except Exception:
            # A real scoreboard fetch failure shouldn't break loading
            # your own roster — next_opponent/game_time just stay
            # absent, same as the pre-draft case.
            games = []
        schedule = _schedule_lookup(games)
        for entry in roster:
            info = schedule.get(entry["pro_team"])
            if info:
                entry.update(info)

    # on_offense/is_redzone only ever mean something for a live game
    # happening right now — never attach them when looking at a
    # different (necessarily not-currently-live) week.
    if is_editable:
        live_status = _live_status_lookup(gamecast_service.all_cached_states())
        for entry in roster:
            info = live_status.get(entry["pro_team"])
            if info:
                entry.update(info)

    return {
        "team_name": team_name,
        "season": active_season,
        "week": requested_week,
        "current_week": current_week,
        "is_editable": is_editable,
        "roster": [_roster_entry_dict(e) for e in roster],
        "roster_slots": roster_slots,
    }


@router.get("/team/ownership")
async def my_team_ownership(request: Request):
    """Real ESPN ownership%/start% for the caller's own roster —
    deliberately a separate endpoint from GET /team, not folded into
    it: this is a real, multi-second live ESPN call (get_bulk_ownership
    is synchronous — same accepted blocking-call pattern get_player_info
    already uses for the player-card feature, see player_info.py), and
    the roster itself should never wait on it. The frontend fetches
    this after the roster already renders.

    Only covers players with a resolved espn_player_id — Sleeper's own
    crosswalk covers roughly 22% of the draftable pool (see
    app/providers/sleeper/ingest.py's canary log), so most entries in
    the response are simply absent, not wrong."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, _ = await _require_my_team(payload, active_season)

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT cr.sleeper_player_id, p.espn_player_id
            FROM current_rosters cr
            JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
            WHERE cr.season = $1 AND cr.team_id = $2 AND p.espn_player_id IS NOT NULL
            """,
            active_season, team_id,
        )

    espn_id_to_sleeper_id = {row["espn_player_id"]: row["sleeper_player_id"] for row in rows}
    if not espn_id_to_sleeper_id:
        return {"ownership": {}}

    ownership_by_espn_id = get_bulk_ownership(list(espn_id_to_sleeper_id.keys()), season=active_season)
    return {
        "ownership": {
            espn_id_to_sleeper_id[espn_id]: data
            for espn_id, data in ownership_by_espn_id.items()
            if espn_id in espn_id_to_sleeper_id
        }
    }


class LineupMoveRequest(BaseModel):
    sleeper_player_id: str
    to_slot: str


class LineupSwapRequest(BaseModel):
    sleeper_player_id_a: str
    sleeper_player_id_b: str


@router.post("/team/lineup/preview-move")
async def preview_lineup_move(body: LineupMoveRequest, request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, league_id = await _require_my_team(payload, active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            plan = await lineup_engine.plan_move(
                conn, active_season, team_id, body.sleeper_player_id, body.to_slot, league_id=league_id
            )
    except LineupError as e:
        raise _map_lineup_error(e) from e

    return {
        "player": _roster_entry_dict(plan["player"]),
        "from_slot": plan["from_slot"],
        "to_slot": plan["to_slot"],
        "displaced_player": _roster_entry_dict(plan["displaced_player"]) if plan["displaced_player"] else None,
    }


@router.post("/team/lineup/preview-swap")
async def preview_lineup_swap(body: LineupSwapRequest, request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, _ = await _require_my_team(payload, active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            plan = await lineup_engine.plan_swap(
                conn, active_season, team_id, body.sleeper_player_id_a, body.sleeper_player_id_b
            )
    except LineupError as e:
        raise _map_lineup_error(e) from e

    return {
        "player_a": _roster_entry_dict(plan["player_a"]),
        "player_b": _roster_entry_dict(plan["player_b"]),
    }


@router.post("/team/lineup/move")
async def submit_lineup_move(body: LineupMoveRequest, request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, league_id = await _require_my_team(payload, active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            roster = await lineup_engine.move_player(
                conn, active_season, team_id, body.sleeper_player_id, body.to_slot, league_id=league_id
            )
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}


@router.post("/team/lineup/swap")
async def submit_lineup_swap(body: LineupSwapRequest, request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, _ = await _require_my_team(payload, active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            roster = await lineup_engine.swap_players(
                conn, active_season, team_id, body.sleeper_player_id_a, body.sleeper_player_id_b
            )
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}


class DropPlayerRequest(BaseModel):
    sleeper_player_id: str


@router.post("/team/lineup/drop")
async def drop_player(body: DropPlayerRequest, request: Request):
    """Real write — sends a player back to free agency, no drop target
    (that's add_free_agent's job when the roster's already full)."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, _ = await _require_my_team(payload, active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            roster = await lineup_engine.drop_player(conn, active_season, team_id, body.sleeper_player_id)
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}


class FreeAgentAddRequest(BaseModel):
    sleeper_player_id: str
    # Only required once a first attempt comes back roster_full — the
    # frontend then re-calls with this set once the visitor picks who
    # to drop.
    drop_sleeper_player_id: str | None = None


@router.post("/team/free-agents/add")
async def add_free_agent(body: FreeAgentAddRequest, request: Request):
    """Real write — no more PREVIEW ONLY. RosterFullError gets its own
    response shape (not the generic 400) — "needs a drop" is a real
    decision for the frontend to act on, not just an error to display."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _, league_id = await _require_my_team(payload, active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            result = await lineup_engine.add_free_agent(
                conn, active_season, team_id, body.sleeper_player_id, body.drop_sleeper_player_id,
                league_id=league_id,
            )
    except RosterFullError as e:
        return JSONResponse(status_code=409, content={"error": "roster_full", "detail": str(e)})
    except LineupError as e:
        raise _map_lineup_error(e) from e

    return {
        "roster": [_roster_entry_dict(e) for e in result["roster"]],
        "dropped_player": _roster_entry_dict(result["dropped_player"]) if result["dropped_player"] else None,
    }


@router.get("/team/free-agents")
async def list_free_agents(request: Request, position: str | None = None, search: str | None = None):
    """The undrafted (season-wide) pool, same shape as /draft/pool minus
    the drafted flag — everyone on this list is by definition
    available.

    projected_points prefers a real, week-specific number from
    player_weekly_projections (harvested from ESPN's real box scores —
    see that table's own migration for its ~83% coverage caveat),
    falling back to players.projected_avg_points (ESPN's own per-game
    average, refreshed by app/domain/player_projections.py — see that
    module's docstring for the 2026-09 fix that made this reliable for
    real rostered/draftable players, D/ST included) for whichever
    players this week's harvest didn't cover — not the season-total
    projected_points column either way, since a per-week number is
    what's actually useful for "who should I add this week," matching
    the reference free-agent browse UI this was modeled on. score is
    this week's already-computed real result (app/domain/
    weekly_stats.py), null pre-kickoff same as My Team's own roster
    view. next_opponent/game_time reuse _schedule_lookup below, the
    same real-scoreboard cross-reference GET /team already does."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        current_week = await league_queries.get_cached_current_week(conn, active_season)

        query = """
            SELECT p.sleeper_player_id, p.full_name, p.position, p.pro_team, p.search_rank, p.injury_status,
                   COALESCE(pwp.projected_points, p.projected_avg_points) AS projected_points,
                   pws.fantasy_points AS score
            FROM players p
            LEFT JOIN player_week_stats pws
                ON pws.season = $1 AND pws.week = $3 AND pws.sleeper_player_id = p.sleeper_player_id
            LEFT JOIN player_weekly_projections pwp
                ON pwp.season = $1 AND pwp.week = $3 AND pwp.sleeper_player_id = p.sleeper_player_id
            WHERE p.is_draftable AND p.sleeper_player_id NOT IN (
                SELECT sleeper_player_id FROM current_rosters WHERE season = $1 AND league_id = $2
            )
        """
        params: list = [active_season, league_id, current_week]
        if position:
            query += f" AND p.position = ${len(params) + 1}"
            params.append(position)
        if search:
            query += f" AND p.full_name ILIKE ${len(params) + 1}"
            params.append(f"%{search}%")
        query += (
            " ORDER BY COALESCE(pwp.projected_points, p.projected_avg_points) DESC NULLS LAST, "
            "p.search_rank ASC NULLS LAST, p.full_name ASC"
        )

        rows = [dict(r) for r in await conn.fetch(query, *params)]

    if current_week is not None:
        try:
            games = await get_week_scoreboard(current_week, active_season)
        except Exception:
            games = []  # a scoreboard fetch failure shouldn't break loading the free-agent list
        schedule = _schedule_lookup(games)
        for row in rows:
            info = schedule.get(row["pro_team"])
            if info:
                row.update(info)

    return {"players": rows}
