"""
Watch Party rooms — group video/voice reached from Chat (2026-09-16
plan). Phase 1: room list/create and LiveKit token minting only. Live
room presence and the fantasy overlay ("sweat index", live scores)
ride their own WebSocket in a later phase — see the approved plan file
for the full picture; this is deliberately just the REST surface a
room needs to exist and be joinable.

Auth pattern copied from app/routers/chat.py (_require_session is a
local per-router helper there too, not shared). League/membership
scoping uses the same require_active_league_id/resolve_owner_id this
whole app's league-scoped routers already depend on.
"""
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, resolve_owner_id
from app.auth.session import decode_session_token, get_session_token
from app.config import _require, require_livekit_configured
from app.db import get_pool
from app.queries import chat as chat_queries
from app.queries import watch_party as watch_party_queries

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


@router.post("/rooms/{room_id}/token")
async def get_room_token(room_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    api_key, api_secret, livekit_url = require_livekit_configured()

    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)

        room = await watch_party_queries.get_room(conn, room_id)
        if room is None or room["league_id"] != league_id or room["closed_at"] is not None:
            raise HTTPException(status_code=404, detail="Room not found")

        # 'open' room membership is implicit — require_active_league_id
        # and resolve_owner_id above already proved this owner belongs
        # to this room's league, which is the whole definition of
        # eligibility for it. Only a 'private' room needs an actual
        # membership-row check.
        if room["kind"] == "private" and not await watch_party_queries.is_private_room_member(conn, room_id, owner_id):
            raise HTTPException(status_code=403, detail="You weren't invited to this party")

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
