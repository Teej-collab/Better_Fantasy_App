"""Commissioner-only force-edit of any member's roster — add or drop a
player on their behalf, using the same in-app current_rosters domain
logic (app/domain/lineup_engine.py) as the self-serve /me/team/* routes
(app/routers/me.py), just with an explicit team_id instead of one
resolved from the caller's own session.

A genuinely different, general-purpose tool from admin_lineup.py's own
ESPN-live-write dry-run test harness (see that module's own docstring:
it reads/writes ESPN's LIVE roster directly, is hardcoded to League #1,
and was built as a one-off spike to prove the ESPN write path works at
all) — this reads/writes this app's own current_rosters system of
record instead, and works for any league the caller commissions.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain import lineup_engine
from app.domain import waivers
from app.domain.lineup_exceptions import (
    AmbiguousDisplacementError,
    LineupError,
    LineupLockedError,
    PlayerAlreadyRosteredError,
    PlayerNotDraftableError,
    PlayerNotOnRosterError,
    PlayerOnWaiversError,
    RosterConfigNotFoundError,
    RosterFullError,
    SlotIneligibleError,
)
from app.domain.nfl_schedule import locked_pro_teams
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.queries import league as league_queries

router = APIRouter(prefix="/leagues", tags=["commissioner-roster"])


async def _locked_pro_teams_for_current_week(conn, active_season: int) -> frozenset[str]:
    """Same best-effort, fail-open lookup as app/routers/me.py's own
    helper of the same name (kept as a separate copy rather than a
    cross-router import, since these are two independently-evolving
    routers) — every real NFL team whose game has already kicked off
    in the league's current fantasy week."""
    current_week = await league_queries.get_cached_current_week(conn, active_season)
    if current_week is None:
        return frozenset()
    try:
        games = await get_week_scoreboard(current_week, active_season)
    except Exception:
        return frozenset()
    return locked_pro_teams(games)


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


# Same mapping as app/routers/me.py's own local _map_lineup_error — one
# error vocabulary for both the self-serve and commissioner-on-behalf-
# of paths through app/domain/lineup_engine.py.
def _map_lineup_error(e: Exception) -> HTTPException:
    if isinstance(e, PlayerNotOnRosterError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, (SlotIneligibleError, AmbiguousDisplacementError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, (RosterConfigNotFoundError, PlayerOnWaiversError)):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, PlayerNotDraftableError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, PlayerAlreadyRosteredError):
        return HTTPException(status_code=400, detail=str(e))
    # Shouldn't actually fire — commissioner_move_player/commissioner_
    # swap_players below deliberately never pass a locked_pro_teams set,
    # which is the whole point of this tool (fixing an already-live
    # lineup a game's kickoff would otherwise block). Mapped anyway
    # rather than falling through to a generic 400, in case that ever
    # changes.
    if isinstance(e, LineupLockedError):
        return HTTPException(status_code=409, detail=str(e))
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
    }


async def _require_team_in_league(conn, league_id: int, team_id: int, season: int) -> None:
    row = await conn.fetchrow(
        "SELECT id FROM teams_by_season WHERE id = $1 AND league_id = $2 AND season = $3",
        team_id, league_id, season,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No team found in this league for that id")


@router.get("/{league_id}/teams/{team_id}/roster")
async def commissioner_get_roster(league_id: int, team_id: int, request: Request):
    """The team's CURRENT in-app roster (current_rosters), not the
    weekly ESPN-synced snapshot GET /teams/{team_id}/roster (league.py)
    reads — that one's scoped to a specific past/current week and can
    disagree with current_rosters after a trade or a drop/add, which
    would be actively misleading for a tool whose whole point is
    showing what's really on the roster right now."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        await _require_team_in_league(conn, league_id, team_id, active_season)
        roster = await lineup_engine.get_roster(conn, active_season, team_id)
    return {"roster": [_roster_entry_dict(e) for e in roster]}


class CommissionerRosterDropRequest(BaseModel):
    sleeper_player_id: str


@router.post("/{league_id}/teams/{team_id}/roster/drop")
async def commissioner_drop_player(league_id: int, team_id: int, body: CommissionerRosterDropRequest, request: Request):
    """Real write — sends a player back to free agency on the target
    team's behalf. Same effect as that owner using /me/team/lineup/drop
    themselves; only who's allowed to trigger it differs."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await require_commissioner_of(conn, payload, league_id)
            await _require_team_in_league(conn, league_id, team_id, active_season)
            roster = await lineup_engine.drop_player(conn, active_season, team_id, body.sleeper_player_id)
            await waivers.start_waiver_clock(conn, active_season, league_id, body.sleeper_player_id)
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}


class CommissionerRosterAddRequest(BaseModel):
    sleeper_player_id: str
    drop_sleeper_player_id: str | None = None
    # Bypasses the normal 1-day waiver period entirely (app/domain/
    # waivers.py) — added for a real incident: an error forced a drop,
    # and the affected owner had no way to get the player back before
    # waivers cleared. False by default even for a commissioner: a
    # first attempt on a genuinely-waived player should still surface
    # that clearly (see the on_waivers response below) rather than
    # silently overriding every time, so the commissioner sees what
    # they're overriding before confirming it.
    override_waivers: bool = False


@router.post("/{league_id}/teams/{team_id}/roster/add")
async def commissioner_add_player(league_id: int, team_id: int, body: CommissionerRosterAddRequest, request: Request):
    """Real write — adds a free agent to the target team's roster on
    their behalf, same roster_full/drop-target handling as the
    self-serve /me/team/free-agents/add, plus an override_waivers
    escape hatch that path doesn't have."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await require_commissioner_of(conn, payload, league_id)
            await _require_team_in_league(conn, league_id, team_id, active_season)
            if not body.override_waivers:
                # A player whose game just kicked off this week may
                # never have actually been dropped by anyone — lazily
                # start their real waiver clock now so add_free_agent's
                # own waiver check below actually sees it. Skipped
                # entirely under override_waivers, same as the check
                # itself: that flag means "bypass waivers outright,"
                # kickoff-based or not.
                locked = await _locked_pro_teams_for_current_week(conn, active_season)
                await waivers.ensure_waiver_clock_if_game_locked(
                    conn, active_season, league_id, body.sleeper_player_id, locked
                )
            try:
                result = await lineup_engine.add_free_agent(
                    conn, active_season, team_id, body.sleeper_player_id, body.drop_sleeper_player_id,
                    league_id=league_id, override_waivers=body.override_waivers,
                )
            except PlayerOnWaiversError as e:
                clears_at_map = await waivers.get_waiver_clears_at(conn, active_season, league_id, [body.sleeper_player_id])
                clears_at = clears_at_map.get(body.sleeper_player_id)
                return JSONResponse(
                    status_code=409,
                    content={
                        "error": "on_waivers",
                        "detail": str(e),
                        "clears_at": clears_at.isoformat() if clears_at else None,
                    },
                )
            if result["dropped_player"] is not None:
                await waivers.start_waiver_clock(
                    conn, active_season, league_id, result["dropped_player"]["sleeper_player_id"]
                )
            if body.override_waivers:
                await waivers.force_clear_waiver(
                    conn, active_season, league_id, body.sleeper_player_id,
                    reason="Force-added by the commissioner before waivers processed",
                )
    except RosterFullError as e:
        return JSONResponse(status_code=409, content={"error": "roster_full", "detail": str(e)})
    except LineupError as e:
        raise _map_lineup_error(e) from e

    return {
        "roster": [_roster_entry_dict(e) for e in result["roster"]],
        "dropped_player": _roster_entry_dict(result["dropped_player"]) if result["dropped_player"] else None,
    }


class CommissionerRosterMoveRequest(BaseModel):
    sleeper_player_id: str
    to_slot: str


@router.post("/{league_id}/teams/{team_id}/roster/move")
async def commissioner_move_player(league_id: int, team_id: int, body: CommissionerRosterMoveRequest, request: Request):
    """Real write — moves a player into a different lineup slot on the
    target team's behalf, same slot-eligibility/displacement rules as
    the self-serve /me/team/lineup/move. The one real difference:
    lineup_engine.move_player's own locked_pro_teams check is never
    populated here (it defaults to an empty set), so this — unlike the
    self-serve path — works on a player whose real game has already
    kicked off. That's the entire point of this endpoint: fixing an
    already-broken, already-live lineup (a real incident — an error
    left a team with no FLEX starter set, which cascaded into every
    slot below it displaying the wrong player in the head-to-head
    table), not something a commissioner should reach for on an
    ordinary, not-yet-locked week."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await require_commissioner_of(conn, payload, league_id)
            await _require_team_in_league(conn, league_id, team_id, active_season)
            roster = await lineup_engine.move_player(
                conn, active_season, team_id, body.sleeper_player_id, body.to_slot, league_id=league_id,
            )
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}


class CommissionerRosterSwapRequest(BaseModel):
    sleeper_player_id_a: str
    sleeper_player_id_b: str


@router.post("/{league_id}/teams/{team_id}/roster/swap")
async def commissioner_swap_players(league_id: int, team_id: int, body: CommissionerRosterSwapRequest, request: Request):
    """Real write — trades two of the target team's own players' lineup
    slots, same eligibility rules (each must be valid for the OTHER's
    current slot) and the same intentional lock bypass as the move
    endpoint above."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await require_commissioner_of(conn, payload, league_id)
            await _require_team_in_league(conn, league_id, team_id, active_season)
            roster = await lineup_engine.swap_players(
                conn, active_season, team_id, body.sleeper_player_id_a, body.sleeper_player_id_b,
            )
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}
