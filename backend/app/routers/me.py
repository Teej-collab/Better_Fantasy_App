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

/team/free-agents/* is a genuine two-track situation right now, not an
oversight:
  - /team/free-agents/preview-add is the OLD path — still ESPN-sourced
    (the public free-agent browse list at /free-agents, and
    FreeAgentsList.tsx's Add button, both use ESPN's numeric player_id).
    It was always preview-only (nothing has ever really submitted an
    ESPN free-agent claim), so leaving it as-is is not a regression.
  - /team/free-agents (GET) and /team/free-agents/add (POST) are the
    NEW path — Sleeper-sourced (sleeper_player_id), backed by
    current_rosters, and /add is a REAL write. Nothing in the frontend
    calls these yet: the public free-agent browse list's ESPN player_id
    doesn't reliably cross-reference to a sleeper_player_id (the
    players.espn_player_id crosswalk is only partially populated — see
    app/providers/sleeper/ingest.py's canary log). Reconciling the two
    (most likely: rebuilding the free-agent browse list itself on the
    Sleeper-sourced `players` pool) is real follow-up work, not done
    here — flagged in TODO.md rather than rushed.

Every endpoint resolves owner_id (and from it, team_id) from the
session — never trusts a client-supplied team/owner id, same discipline
as keepers.py/settings.py.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.config import SessionConfig
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
from app.domain.your_week import build_your_week
from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.lineup_exceptions import RosterFullError as ESPNRosterFullError
from app.queries import league as league_queries
from app.routers.lineup_shared import map_lineup_error, roster_entry_dict

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


async def _require_my_team(owner_id: int, active_season: int) -> tuple[int, str]:
    """Internal team_id (teams_by_season.id — what current_rosters keys
    on), not espn_team_id. Every /me/team/* route needs this instead
    now that nothing here calls ESPN."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        team = await conn.fetchrow(
            "SELECT id, team_name FROM teams_by_season WHERE season = $1 AND owner_id = $2",
            active_season, owner_id,
        )
    if team is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return team["id"], team["team_name"]


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
    }


@router.get("/week")
async def week(request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await build_your_week(conn, payload["owner_id"], active_season)

    if result is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return result


@router.get("/team")
async def my_team(request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, team_name = await _require_my_team(payload["owner_id"], active_season)

    pool = await get_pool()
    async with pool.acquire() as conn:
        roster = await lineup_engine.get_roster(conn, active_season, team_id)

    return {
        "team_name": team_name,
        "season": active_season,
        "roster": [_roster_entry_dict(e) for e in roster],
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
    team_id, _ = await _require_my_team(payload["owner_id"], active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            plan = await lineup_engine.plan_move(conn, active_season, team_id, body.sleeper_player_id, body.to_slot)
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
    team_id, _ = await _require_my_team(payload["owner_id"], active_season)

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
    team_id, _ = await _require_my_team(payload["owner_id"], active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            roster = await lineup_engine.move_player(conn, active_season, team_id, body.sleeper_player_id, body.to_slot)
    except LineupError as e:
        raise _map_lineup_error(e) from e
    return {"roster": [_roster_entry_dict(e) for e in roster]}


@router.post("/team/lineup/swap")
async def submit_lineup_swap(body: LineupSwapRequest, request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    team_id, _ = await _require_my_team(payload["owner_id"], active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            roster = await lineup_engine.swap_players(
                conn, active_season, team_id, body.sleeper_player_id_a, body.sleeper_player_id_b
            )
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
    team_id, _ = await _require_my_team(payload["owner_id"], active_season)

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            result = await lineup_engine.add_free_agent(
                conn, active_season, team_id, body.sleeper_player_id, body.drop_sleeper_player_id
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
    available."""
    _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))

    query = """
        SELECT p.sleeper_player_id, p.full_name, p.position, p.pro_team, p.search_rank, p.injury_status
        FROM players p
        WHERE p.is_draftable AND p.sleeper_player_id NOT IN (
            SELECT sleeper_player_id FROM current_rosters WHERE season = $1
        )
    """
    params: list = [active_season]
    if position:
        query += f" AND p.position = ${len(params) + 1}"
        params.append(position)
    if search:
        query += f" AND p.full_name ILIKE ${len(params) + 1}"
        params.append(f"%{search}%")
    query += " ORDER BY p.search_rank ASC NULLS LAST, p.full_name ASC"

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return {"players": [dict(r) for r in rows]}


async def _require_my_espn_team_id(owner_id: int, active_season: int) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        team = await league_queries.get_team_for_owner(conn, active_season, owner_id)
    if team is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return team["espn_team_id"]


class AddFreeAgentPreviewRequest(BaseModel):
    player_id: int
    player_name: str
    position: str
    pro_team: str
    drop_player_name: str | None = None


@router.post("/team/free-agents/preview-add")
async def preview_add_free_agent(body: AddFreeAgentPreviewRequest, request: Request):
    """OLD, ESPN-sourced path — PREVIEW ONLY, see module docstring's
    two-track explanation. Feeds FreeAgentsList.tsx (the public
    /free-agents browse page), which still lists ESPN's free-agent pool
    (with real ownership%/projections ESPN computes) — nothing here has
    ever submitted a real claim to ESPN, so this being preview-only is
    unchanged behavior, not a regression from the ESPN-independence
    pivot."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        plan = client.plan_add_player(
            espn_team_id,
            body.player_id,
            body.player_name,
            body.position,
            body.pro_team,
            body.drop_player_name,
            active_season,
        )
    except ESPNRosterFullError as e:
        return JSONResponse(status_code=409, content={"error": "roster_full", "detail": str(e)})
    except Exception as e:
        raise map_lineup_error(e) from e

    return {
        "added_player": {
            "player_id": plan.added_player_id,
            "player_name": plan.added_player_name,
            "position": plan.added_position,
            "pro_team": plan.added_pro_team,
        },
        "roster_size_before": plan.roster_size_before,
        "roster_capacity": plan.roster_capacity,
        "dropped_player": roster_entry_dict(plan.dropped_player) if plan.dropped_player else None,
    }
