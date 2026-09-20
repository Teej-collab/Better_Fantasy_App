"""
Watch Party rooms — group video/voice reached from Chat (2026-09-16
plan). Phase 1: room list/create and LiveKit token minting. Phase 2: a
WebSocket per room broadcasting the live "fantasy digest" (close/live
league matchups) — see app/domain/watch_party.py and
app/watch_party/manager.py, and the scheduler job in app/scheduler.py
that actually pushes updates on a poll cadence. Phase 3: each room's
text chat reuses the existing chat stack rather than a second one —
see app/queries/watch_party.py's own docstring on how a room links to
a real conversations row.

Auth pattern copied from app/routers/chat.py (_require_session is a
local per-router helper there too, not shared). League/membership
scoping uses the same require_active_league_id/resolve_owner_id this
whole app's league-scoped routers already depend on.
"""
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, resolve_owner_id
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, decode_ticket_token, get_session_token
from app.config import _require, require_livekit_configured
from app.db import get_pool
from app.domain import watch_party as watch_party_domain
from app.queries import chat as chat_queries
from app.queries import watch_party as watch_party_queries
from app.watch_party.manager import manager as watch_party_manager

router = APIRouter(prefix="/watch-party", tags=["watch_party"])

# A real watch-party session can run for an entire game slate — much
# longer than the existing WS ticket's 60s or even the chug upload
# ticket's 15 minutes (see auth.py's TICKET_PURPOSES). Rather than mint
# one token that has to outlive an entire Sunday, the frontend is
# expected to re-request a token well before this expires; 6 hours
# comfortably covers one sitting without leaving a token usable long
# after someone's actually done watching.
TOKEN_TTL_SECONDS = 6 * 60 * 60


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(get_session_token(request))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def _room_dict(row, member_count: int) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "created_by_owner_id": row["created_by_owner_id"],
        "member_count": member_count,
        "conversation_id": row["conversation_id"],
    }


@router.get("/rooms")
async def list_rooms(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        active_season = int(_require("ACTIVE_SEASON"))

        open_room = await watch_party_queries.get_or_create_open_room(conn, league_id, owner_id)
        # list_eligible_members excludes the requester themselves (see
        # its own docstring) — +1 accounts for that so the open room's
        # count reads as "everyone", not "everyone but you".
        eligible = await chat_queries.list_eligible_members(conn, active_season, league_id, owner_id)
        private_rooms = await watch_party_queries.list_private_rooms_for_owner(conn, league_id, owner_id)

    return {
        "open_room": _room_dict(open_room, len(eligible) + 1),
        "private_rooms": [_room_dict(r, r["member_count"]) for r in private_rooms],
    }


@router.post("/rooms")
async def create_room(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    invited_owner_ids = body.get("invited_owner_ids") or []
    if not name:
        raise HTTPException(status_code=400, detail="Party name is required")
    if not isinstance(invited_owner_ids, list) or not all(isinstance(i, int) for i in invited_owner_ids):
        raise HTTPException(status_code=400, detail="invited_owner_ids must be a list of owner ids")

    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        active_season = int(_require("ACTIVE_SEASON"))

        # Only real league members can be invited — the same pool
        # chat's own "new message" search draws from, not an arbitrary
        # owner id someone could otherwise pass in the request body.
        eligible_ids = {
            m["owner_id"] for m in await chat_queries.list_eligible_members(conn, active_season, league_id, owner_id)
        }
        invalid = [i for i in invited_owner_ids if i not in eligible_ids]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Not a member of your league: {invalid}")

        room_id = await watch_party_queries.create_private_room(conn, league_id, name, owner_id, invited_owner_ids)

    return {"id": room_id}


async def _room_if_accessible(conn, room_id: int, league_id: int, owner_id: int):
    """None if the room doesn't exist, belongs to another league, is
    closed, or (for a 'private' room) this owner was never invited.
    'open' room membership is implicit — require_active_league_id and
    resolve_owner_id having already succeeded for this league IS the
    whole definition of eligibility for it; only 'private' rooms need
    an actual membership-row check. Shared by the token endpoint and
    the /ws route below so the two never drift out of sync on who's
    actually allowed into a room."""
    room = await watch_party_queries.get_room(conn, room_id)
    if room is None or room["league_id"] != league_id or room["closed_at"] is not None:
        return None
    if room["kind"] == "private" and not await watch_party_queries.is_private_room_member(conn, room_id, owner_id):
        return None
    return room


@router.post("/rooms/{room_id}/token")
async def get_room_token(room_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    api_key, api_secret, livekit_url = require_livekit_configured()

    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)

        room = await _room_if_accessible(conn, room_id, league_id, owner_id)
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found")

        # First real "joining" moment for the open room (a private
        # room's invitees are already participants from creation) — see
        # ensure_conversation_participant's own docstring.
        await watch_party_queries.ensure_conversation_participant(conn, room["conversation_id"], owner_id)

        display_name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)

    now = int(time.time())
    # Scoped by league AND room id, not just room id, so a room id
    # collision across two different leagues (ids are global, not
    # per-league) can never land two unrelated leagues in the same
    # LiveKit room by accident.
    livekit_room_name = f"league-{league_id}-room-{room_id}"
    claims = {
        "iss": api_key,
        "sub": str(owner_id),
        "name": display_name or "Owner",
        "nbf": now,
        "exp": now + TOKEN_TTL_SECONDS,
        # Video grant shape confirmed against LiveKit's own
        # python-sdks source (livekit-api/livekit/api/access_token.py)
        # rather than assumed — see app/config.py's comment.
        "video": {
            "room": livekit_room_name,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    token = jwt.encode(claims, api_secret, algorithm="HS256")

    return {"token": token, "url": livekit_url, "room_name": livekit_room_name}


@router.websocket("/ws")
async def watch_party_ws(websocket: WebSocket, room_id: int, ticket: str | None = None):
    """Push-only, same shape as Gamecast's own /nfl/gamecast/ws — sends
    one fantasy_digest snapshot immediately on connect (if one's
    computable right now), then the scheduler job's poll results get
    broadcast to every connected socket for this room_id (see
    _run_watch_party_poll_job in app/scheduler.py). This socket never
    reads anything meaningful from the client; any inbound payload is
    ignored, same as Gamecast's."""
    payload = _decode_session(websocket.cookies.get(SESSION_COOKIE_NAME))
    if payload is None and ticket:
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="watch_party_ws")
    if payload is None:
        await websocket.close(code=4401)
        return

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            # require_active_league_id raises HTTPException (409) for a
            # signed-in-but-no-active-league visitor — meaningless in a
            # WS context, so it's translated into a close code here
            # rather than left to propagate as an unhandled exception.
            league_id = await require_active_league_id(conn, payload)
            owner_id = await resolve_owner_id(conn, payload)
            room = await _room_if_accessible(conn, room_id, league_id, owner_id)
            if room is not None:
                # Idempotent, and cheap insurance against this socket
                # ever connecting before the token endpoint's own call —
                # see ensure_conversation_participant's docstring.
                await watch_party_queries.ensure_conversation_participant(conn, room["conversation_id"], owner_id)
    except HTTPException:
        await websocket.close(code=4409)
        return
    if room is None:
        await websocket.close(code=4404)
        return

    await watch_party_manager.connect(room_id, websocket)
    try:
        async with pool.acquire() as conn:
            digest = await watch_party_domain.build_fantasy_digest(conn, league_id)
        if digest is not None:
            await websocket.send_json(digest)

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        watch_party_manager.disconnect(room_id, websocket)
