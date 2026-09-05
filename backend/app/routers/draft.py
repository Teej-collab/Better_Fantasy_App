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
app/routers/me.py and keepers.py. Every endpoint also resolves
league_id from the session (app/auth/league_context.py) — never a
client-supplied value — so a signed-in visitor can only ever act on
their own active league's draft, never one they merely guess the
season of (see TODO.md's PHASE 9 entry).
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, decode_ticket_token
from app.config import _require
from app.db import get_pool
from app.domain import draft_engine
from app.domain.draft_exceptions import (
    DraftAlreadyExistsError,
    DraftAlreadyStartedError,
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
from app.notifications.draft_events import notify_on_the_clock
from app.queries import draft as draft_queries

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
    if isinstance(e, DraftAlreadyStartedError):
        return HTTPException(status_code=409, detail=str(e))
    # InvalidDraftOrderError falls through to the generic 400 below —
    # same status the catch-all already gives it, just named for the
    # domain layer's own "one class per real failure mode" discipline.
    return HTTPException(status_code=400, detail=str(e))


@router.get("/pool")
async def draft_pool(request: Request, position: str | None = None, search: str | None = None):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rows = await draft_queries.get_draft_pool(conn, season, position, search, league_id)
    return {"players": [dict(r) for r in rows]}


@router.get("/state")
async def draft_state(request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        state = await draft_queries.get_draft_state(conn, season, league_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No draft configured for this season")
    # In-process presence, not a DB read — who's actually got the draft
    # room open right now (app/draft/manager.py), same "who's signed
    # in" signal the WS handshake's own draft_state frame carries. This
    # REST read is what a fresh page load (draft/page.tsx's server-side
    # fetch, before the WS even connects) shows first.
    return {**state, "connected_owner_ids": manager.connected_owner_ids((season, league_id))}


class PickRequest(BaseModel):
    sleeper_player_id: str


@router.post("/pick")
async def submit_pick(body: PickRequest, request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_active_league_id(conn, payload)
            result = await draft_engine.make_pick(
                conn, season, payload["owner_id"], body.sleeper_player_id, league_id=league_id
            )
    except DraftError as e:
        raise _map_draft_error(e) from e

    await manager.broadcast_to_draft((season, league_id), {"type": "pick_made", **result})
    await notify_on_the_clock(season, league_id, result["config"])
    return result


class SetupRequest(BaseModel):
    draft_order: list[int]
    roster_slots: dict[str, int]
    pick_time_limit_seconds: int = 90
    position_max: dict[str, int] | None = None


@router.post("/setup")
async def setup_draft(body: SetupRequest, request: Request):
    """Refuses to overwrite an existing draft (see create_draft's
    docstring) — call POST /draft/reset first to change the order or
    roster shape, whether that's redoing a mock draft or genuinely
    reconfiguring before the real one.

    position_max: falls back to whatever's already staged (PUT /draft/
    position-max, ahead of this call) when the request omits it, same
    "don't make the caller re-send something already set" convenience
    roster_slots itself doesn't need (DraftSetupPanel.tsx always
    pre-fills and re-sends that one explicitly)."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            position_max = body.position_max
            if position_max is None:
                position_max = await draft_queries.get_position_max_setting(conn, season, league_id)
            await draft_engine.create_draft(
                conn, season, body.draft_order, body.roster_slots, body.pick_time_limit_seconds,
                league_id=league_id, position_max=position_max,
            )
            state = await draft_queries.get_draft_state(conn, season, league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    return state


class ScheduleRequest(BaseModel):
    # The frontend converts its <input type="datetime-local"> value
    # (naive, in the commissioner's own browser-local time) to a real
    # UTC-aware ISO string (`new Date(...).toISOString()`) before
    # sending it — a naive string here would be genuinely ambiguous
    # (whose timezone?), and storing a naive value as TIMESTAMPTZ would
    # silently assume the DB session's own timezone, not the
    # commissioner's, which could be hours off. Pydantic parses the
    # real offset into a timezone-aware datetime; asyncpg stores the
    # actual UTC instant, and every viewer gets it back re-rendered in
    # their own local time client-side, same convention already used
    # for game times elsewhere.
    scheduled_start: datetime


@router.get("/schedule")
async def get_draft_schedule(request: Request):
    """The real draft time, whichever of draft_config/league_draft_schedule
    currently holds it (get_effective_scheduled_start) — lets
    DraftSetupPanel.tsx show/pre-fill a previously-set date even before
    a real draft exists yet (GET /draft/state 404s in that case, so it
    can't come from there). Any signed-in league member can read this,
    same as GET /draft/pool — not commissioner-only, only setting it is."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        scheduled_start = await draft_queries.get_effective_scheduled_start(conn, season, league_id)
    return {"scheduled_start": scheduled_start}


@router.put("/schedule")
async def set_draft_schedule(body: ScheduleRequest, request: Request):
    """Separate from /draft/setup on purpose — the commissioner should
    be able to nail down or adjust the real date/time without resetting
    draft_order/roster_slots, and without deciding the order/roster
    shape first at all: set_scheduled_start holds the time in
    league_draft_schedule until a real draft exists (see that table's
    migration docstring), so this never 404s. Returns the real draft
    state if one exists yet, else null — the caller (DraftSetupPanel.tsx)
    doesn't read this response, just re-fetches state after saving."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            await draft_engine.set_scheduled_start(conn, season, body.scheduled_start, league_id=league_id)
            state = await draft_queries.get_draft_state(conn, season, league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    return state


class RosterSlotsRequest(BaseModel):
    roster_slots: dict[str, int]


@router.get("/roster-slots")
async def get_roster_slots(request: Request):
    """The season's roster shape, wherever it currently lives (see
    get_effective_roster_slots) — any signed-in league member can read
    this, same openness as GET /draft/schedule; only setting it is
    commissioner-only. `editable` tells the caller (the commissioner's
    Roster & Keepers page) whether PUT will actually succeed — false
    once a real draft exists for this season, since changing shape
    then would leave already-generated draft_picks rows built for a
    different round count (see PUT's own docstring)."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        roster_slots = await draft_queries.get_effective_roster_slots(conn, season, league_id)
        draft_exists = await conn.fetchval(
            "SELECT 1 FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
        )
    return {"season": season, "roster_slots": roster_slots, "editable": not draft_exists}


@router.put("/roster-slots")
async def set_roster_slots(body: RosterSlotsRequest, request: Request):
    """Stages a roster shape ahead of a real draft (league_roster_slots_
    settings — see that table's own migration docstring for why this
    can't just write into a stub draft_config row). Refuses once a real
    draft_config row exists for this season: draft_picks' round count
    is fixed at setup time from the ORIGINAL roster shape
    (total_draftable_slots), so silently changing roster_slots
    afterward would leave those pre-generated pick rows built for the
    wrong number of rounds — reset the draft first (same requirement
    changing draft_order/roster_slots via Draft Setup has always had)."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        exists = await conn.fetchval(
            "SELECT 1 FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
        )
        if exists:
            raise HTTPException(
                status_code=409,
                detail="A draft already exists for this season — reset it first if you need to change roster shape",
            )
        await draft_queries.upsert_roster_slots_setting(conn, season, body.roster_slots, league_id)
    return {"season": season, "roster_slots": body.roster_slots, "editable": True}


class PositionMaxRequest(BaseModel):
    position_max: dict[str, int]


@router.get("/position-max")
async def get_position_max(request: Request):
    """The season's per-position roster caps (autopick's own guardrail —
    see draft_autopick.py), wherever they currently live. Unlike
    roster-slots' `editable`, this is always True: a position cap never
    affects round count or already-generated draft_picks rows, so it
    can always be changed, including mid-draft (see PUT's own
    docstring)."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        position_max = await draft_queries.get_effective_position_max(conn, season, league_id)
    return {"season": season, "position_max": position_max, "editable": True}


@router.put("/position-max")
async def set_position_max(body: PositionMaxRequest, request: Request):
    """Sets per-position roster caps, e.g. {"QB": 4, "RB": 8} to match
    ESPN's own league-settings display — updates the live draft_config
    directly if a real draft already exists for this season (safe at
    any status, unlike roster-slots: see draft_engine.update_position_max's
    own docstring for why), otherwise stages it the same way roster-
    slots does ahead of a real draft."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        exists = await conn.fetchval(
            "SELECT 1 FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
        )
        if exists:
            await draft_engine.update_position_max(conn, season, body.position_max, league_id)
        else:
            await draft_queries.upsert_position_max_setting(conn, season, body.position_max, league_id)
    return {"season": season, "position_max": body.position_max, "editable": True}


class DraftOrderRequest(BaseModel):
    draft_order: list[int]


@router.put("/order")
async def set_draft_order(body: DraftOrderRequest, request: Request):
    """Reorders an existing, not-yet-started draft without resetting it
    (see draft_engine.update_draft_order's own docstring for exactly
    when this is and isn't allowed) — the common case of just wanting a
    different pick order, not a different roster shape or pick-time-
    limit, which POST /draft/reset + /draft/setup would otherwise force
    the commissioner to redo from scratch."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            config = await draft_engine.update_draft_order(conn, season, body.draft_order, league_id=league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    return config


@router.post("/reset")
async def reset_draft(request: Request):
    """Wipes this season's draft entirely (config, every pick,
    every current_rosters row it seeded) regardless of status — see
    draft_engine.reset_draft's docstring. Use this to redo a mock draft
    or change the order/roster shape before the real one."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await draft_engine.reset_draft(conn, season, league_id=league_id)
    await manager.broadcast_to_draft((season, league_id), {"type": "draft_reset"})
    return {"ok": True}


class KeeperSeedRequest(BaseModel):
    owner_id: int
    round: int
    sleeper_player_id: str


@router.post("/keeper")
async def seed_keeper(body: KeeperSeedRequest, request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            await draft_engine.seed_keeper_pick(
                conn, season, body.owner_id, body.round, body.sleeper_player_id, league_id=league_id
            )
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
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            seeded = await draft_engine.seed_keepers_from_locked_selections(conn, season, league_id=league_id)
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
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            config = await draft_engine.start_draft(conn, season, league_id=league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    result = {"type": "draft_status", "config": dict(config)}
    await manager.broadcast_to_draft((season, league_id), result)
    await notify_on_the_clock(season, league_id, config)
    return result


@router.post("/pause")
async def pause_draft(request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            config = await draft_engine.pause_draft(conn, season, league_id=league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    result = {"type": "draft_status", "config": dict(config)}
    await manager.broadcast_to_draft((season, league_id), result)
    return result


@router.post("/resume")
async def resume_draft(request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            config = await draft_engine.resume_draft(conn, season, league_id=league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    result = {"type": "draft_status", "config": dict(config)}
    await manager.broadcast_to_draft((season, league_id), result)
    await notify_on_the_clock(season, league_id, config)
    return result


@router.post("/undo-last-pick")
async def undo_last_pick(request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            result = await draft_engine.undo_last_pick(conn, season, league_id=league_id)
    except DraftError as e:
        raise _map_draft_error(e) from e
    await manager.broadcast_to_draft((season, league_id), {"type": "pick_undone", **result})
    await notify_on_the_clock(season, league_id, result["config"])
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

    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            league_id = await require_active_league_id(conn, payload)
        except HTTPException:
            # require_active_league_id raises for a normal HTTP request;
            # a WebSocket has no HTTP response to send, so translate to
            # a close code instead — same convention as the no-payload
            # case above.
            await websocket.close(code=4401)
            return
        state = await draft_queries.get_draft_state(conn, season, league_id)

    owner_id = payload["owner_id"]
    room = (season, league_id)
    await manager.connect(room, owner_id, websocket)
    try:
        if state is None:
            await websocket.send_json({"type": "error", "detail": "No draft configured for this season"})
            await websocket.close(code=4404)
            return
        # connected_owner_ids includes this connection itself (just
        # added above) — a client that joins mid-draft needs this
        # initial snapshot since it won't see its own past "presence"
        # broadcasts, same as GET /chat/members' own initial-online-
        # snapshot reasoning.
        state_with_presence = {**state, "connected_owner_ids": manager.connected_owner_ids(room)}
        await websocket.send_json(jsonable_encoder({"type": "draft_state", **state_with_presence}))

        # Receive-only, same as gamecast_ws — nothing a client needs to
        # send the draft room beyond the handshake; receive_text() here
        # exists purely to detect disconnects.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, owner_id, websocket)
