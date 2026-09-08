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
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain import lineup_engine
from app.domain import waivers
from app.domain.lineup_exceptions import (
    AmbiguousDisplacementError,
    LineupError,
    PlayerAlreadyRosteredError,
    PlayerNotDraftableError,
    PlayerNotOnRosterError,
    PlayerOnWaiversError,
    RosterConfigNotFoundError,
    RosterFullError,
    SlotIneligibleError,
)

router = APIRouter(prefix="/leagues", tags=["commissioner-roster"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
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


@router.post("/{league_id}/teams/{team_id}/roster/add")
async def commissioner_add_player(league_id: int, team_id: int, body: CommissionerRosterAddRequest, request: Request):
    """Real write — adds a free agent to the target team's roster on
    their behalf, same roster_full/drop-target handling as the
    self-serve /me/team/free-agents/add."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await require_commissioner_of(conn, payload, league_id)
            await _require_team_in_league(conn, league_id, team_id, active_season)
            result = await lineup_engine.add_free_agent(
                conn, active_season, team_id, body.sleeper_player_id, body.drop_sleeper_player_id,
                league_id=league_id,
            )
            if result["dropped_player"] is not None:
                await waivers.start_waiver_clock(
                    conn, active_season, league_id, result["dropped_player"]["sleeper_player_id"]
                )
    except RosterFullError as e:
        return JSONResponse(status_code=409, content={"error": "roster_full", "detail": str(e)})
    except LineupError as e:
        raise _map_lineup_error(e) from e

    return {
        "roster": [_roster_entry_dict(e) for e in result["roster"]],
        "dropped_player": _roster_entry_dict(result["dropped_player"]) if result["dropped_player"] else None,
    }
