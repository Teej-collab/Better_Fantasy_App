"""
The in-app real-time draft — REST for setup/state/picks, one WebSocket
per client for live updates. Mirrors app/routers/gamecast.py's split
and its exact session-cookie-or-ticket WS auth (same "ws" ticket
purpose, nothing purpose-specific about that string — see gamecast.py's
own docstring). See app/domain/draft_engine.py for the actual turn/pick
logic this router is a thin HTTP wrapper around, and the project plan
for why this exists at all (replacing ESPN's draft, which this league
has never had an in-app alternative to before).

Every mutating endpoint resolves owner_id from the session — the same
"never trust a client-supplied team/owner id" discipline as
app/routers/me.py and keepers.py. Commissioner-only setup/control
endpoints reuse _require_commissioner from admin.py.
"""
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, decode_ticket_token
from app.config import _require
from app.db import get_pool
from app.domain import draft_engine
from app.domain.draft_exceptions import (
    DraftAlreadyExistsError,
    DraftError,
    DraftNotFoundError,
    DraftNotInProgressError,
    KeeperResolutionError,
    NothingToUndoError,
    NotYourTurnError,
    PlayerAlreadyDraftedError,
    PlayerNotDraftableError,
)
from app.draft.manager import manager
from app.queries import draft as draft_queries
from app.routers.admin import _require_commissioner

router = APIRouter(prefix="/draft", tags=["draft"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


def _map_draft_error(e: Exception) -> HTTPException:
    if isinstance(e, DraftNotFoundError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, (NotYourTurnError, DraftNotInProgressError)):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, (PlayerNotDraftableError, PlayerAlreadyDraftedError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, NothingToUndoError):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, DraftAlreadyExistsError):
        return HTTPException(status_code=409, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


@router.get("/pool")
async def draft_pool(request: Request, position: str | None = None, search: str | None = None):
    _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await draft_queries.get_draft_pool(conn, season, position, search)
    return {"players": [dict(r) for r in rows]}


@router.get("/state")
async def draft_state(request: Request):
    _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        state = await draft_queries.get_draft_state(conn, season)
    if state is None:
        raise HTTPException(status_code=404, detail="No draft configured for this season")
    return state


class PickRequest(BaseModel):
    sleeper_player_id: str


@router.post("/pick")
async def submit_pick(body: PickRequest, request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            result = await draft_engine.make_pick(conn, season, payload["owner_id"], body.sleeper_player_id)
    except DraftError as e:
        raise _map_draft_error(e) from e

    await manager.broadcast_to_draft(season, {"type": "pick_made", **result})
    return result


class SetupRequest(BaseModel):
    draft_order: list[int]
    roster_slots: dict[str, int]
    pick_time_limit_seconds: int = 90


@router.post("/setup")
async def setup_draft(body: SetupRequest, request: Request):
    """Refuses to overwrite an existing draft (see create_draft's
    docstring) — call POST /draft/reset first to change the order or
    roster shape, whether that's redoing a mock draft or genuinely
    reconfiguring before the real one."""
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await draft_engine.create_draft(
                conn, season, body.draft_order, body.roster_slots, body.pick_time_limit_seconds
            )
            state = await draft_queries.get_draft_state(conn, season)
    except DraftError as e:
        raise _map_draft_error(e) from e
    return state


@router.post("/reset")
async def reset_draft(request: Request):
    """Wipes this season's draft entirely (config, every pick,
    every current_rosters row it seeded) regardless of status — see
    draft_engine.reset_draft's docstring. Use this to redo a mock draft
    or change the order/roster shape before the real one."""
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await draft_engine.reset_draft(conn, season)
    await manager.broadcast_to_draft(season, {"type": "draft_reset"})
    return {"ok": True}


class KeeperSeedRequest(BaseModel):
    owner_id: int
    round: int
    sleeper_player_id: str


@router.post("/keeper")
async def seed_keeper(body: KeeperSeedRequest, request: Request):
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await draft_engine.seed_keeper_pick(conn, season, body.owner_id, body.round, body.sleeper_player_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    return {"ok": True}


@router.post("/seed-keepers")
async def seed_keepers(request: Request):
    """Batch version of POST /draft/keeper — resolves every LOCKED
    keeper_selections row for the active season into a real draft pick
    (the last round, this league's first year in the app) in one call,
    instead of a commissioner manually resolving and POSTing one owner
    at a time. See draft_engine.seed_keepers_from_locked_selections for
    the full ordering/idempotency/all-or-nothing rules."""
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            seeded = await draft_engine.seed_keepers_from_locked_selections(conn, season)
    except KeeperResolutionError as e:
        raise HTTPException(
            status_code=400,
            detail={"message": str(e), "unresolved": e.unresolved},
        ) from e
    except DraftError as e:
        raise _map_draft_error(e) from e
    return {"seeded": seeded}


@router.post("/start")
async def start_draft(request: Request):
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            config = await draft_engine.start_draft(conn, season)
    except DraftError as e:
        raise _map_draft_error(e) from e
    result = {"type": "draft_status", "config": dict(config)}
    await manager.broadcast_to_draft(season, result)
    return result


@router.post("/pause")
async def pause_draft(request: Request):
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            config = await draft_engine.pause_draft(conn, season)
    except DraftError as e:
        raise _map_draft_error(e) from e
    result = {"type": "draft_status", "config": dict(config)}
    await manager.broadcast_to_draft(season, result)
    return result


@router.post("/resume")
async def resume_draft(request: Request):
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            config = await draft_engine.resume_draft(conn, season)
    except DraftError as e:
        raise _map_draft_error(e) from e
    result = {"type": "draft_status", "config": dict(config)}
    await manager.broadcast_to_draft(season, result)
    return result


@router.post("/undo-last-pick")
async def undo_last_pick(request: Request):
    _require_commissioner(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            result = await draft_engine.undo_last_pick(conn, season)
    except DraftError as e:
        raise _map_draft_error(e) from e
    await manager.broadcast_to_draft(season, {"type": "pick_undone", **result})
    return result


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


@router.websocket("/ws")
async def draft_ws(websocket: WebSocket, season: int, ticket: str | None = None):
    payload = _decode_session(websocket.cookies.get(SESSION_COOKIE_NAME))
    if payload is None and ticket:
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="ws")
    if payload is None:
        await websocket.close(code=4401)
        return

    await manager.connect(season, websocket)
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            state = await draft_queries.get_draft_state(conn, season)
        if state is None:
            await websocket.send_json({"type": "error", "detail": "No draft configured for this season"})
            await websocket.close(code=4404)
            return
        await websocket.send_json(jsonable_encoder({"type": "draft_state", **state}))

        # Receive-only, same as gamecast_ws — nothing a client needs to
        # send the draft room beyond the handshake; receive_text() here
        # exists purely to detect disconnects.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(season, websocket)
