"""
Lounge — standalone, password-protected video rooms (2026-09 plan).

Deliberately NOT an extension of Watch Party (app/routers/watch_party.py):
Watch Party rooms are hard-scoped to a league (NOT NULL league_id) and
gated by league membership, with participants always being an
`owners` row. Lounge exists for the opposite case — anyone with a
Better Fantasy App account (no league required at all, same as
email/password signup in app/routers/auth.py) can create a room, and
anyone at all — including a fully logged-out visitor with no account —
can join it, gated only by a password, never league membership. The
two features intentionally do not share tables, routes, or a router.

Auth pattern: create/list/close require a real session (local
_require_session, same per-router-copy idiom already used in
chat.py/gamecast.py/watch_party.py). The metadata and join routes are
public — join optionally decodes a session if one happens to be
present (a logged-in visitor joining their own or a friend's room still
gets their real identity), but never requires one.

The invite link a creator shares only ever contains the room's slug —
the password is always typed separately by the joiner, never embedded
in a URL, never cached client-side.
"""
import secrets
import time
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.passwords import MIN_PASSWORD_LENGTH, hash_password, verify_password
from app.auth.session import decode_session_token, get_session_token
from app.config import require_livekit_configured
from app.db import get_pool
from app.queries import lounge as lounge_queries

router = APIRouter(prefix="/lounge", tags=["lounge"])

# Matches Watch Party's own TOKEN_TTL_SECONDS rationale (app/routers/
# watch_party.py) — long enough to cover one real sitting without the
# frontend needing to babysit a refresh mid-call.
TOKEN_TTL_SECONDS = 6 * 60 * 60

MAX_FAILED_ATTEMPTS = 8
LOCKOUT_MINUTES = 15
MAX_DISPLAY_NAME_LENGTH = 40


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


def _public_room_dict(row) -> dict:
    """Only ever what a stranger with the slug is allowed to learn
    before typing a password — never password_hash, failed_attempts,
    locked_until, created_by_user_id, or even the numeric id."""
    return {"name": row["name"], "closed": row["closed_at"] is not None}


def _is_locked(row) -> bool:
    return row["locked_until"] is not None and row["locked_until"] > datetime.now(timezone.utc)


def _clean_display_name(raw: str) -> str:
    cleaned = "".join(ch for ch in raw.strip() if ch.isprintable())
    return cleaned[:MAX_DISPLAY_NAME_LENGTH]


@router.post("/rooms")
async def create_room(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    body = await request.json()

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Room name is required")

    password = body.get("password") or ""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    # Deliberately more entropy than leagues.invite_code's
    # token_urlsafe(8) (see migration docstring) — no collision-retry
    # loop needed, same judgment call leagues.py's own invite code
    # generation already makes.
    slug = secrets.token_urlsafe(12)
    password_hash = hash_password(password)

    async with pool.acquire() as conn:
        room_id = await lounge_queries.create_room(
            conn,
            slug=slug,
            name=name,
            password_hash=password_hash,
            created_by_user_id=payload["user_id"],
        )

    return {"id": room_id, "slug": slug, "name": name}


@router.get("/rooms")
async def list_rooms(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        rows = await lounge_queries.list_rooms_for_creator(conn, payload["user_id"])
    return {
        "rooms": [
            {
                "id": r["id"],
                "slug": r["slug"],
                "name": r["name"],
                "closed": r["closed_at"] is not None,
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


@router.get("/rooms/{slug}")
async def get_room_meta(slug: str, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        room = await lounge_queries.get_room_by_slug(conn, slug)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return _public_room_dict(room)


@router.post("/rooms/{slug}/join")
async def join_room(slug: str, request: Request, pool=Depends(get_pool)):
    api_key, api_secret, livekit_url = require_livekit_configured()
    body = await request.json()

    async with pool.acquire() as conn:
        room = await lounge_queries.get_room_by_slug(conn, slug)
        # A closed room reads identically to a nonexistent one here —
        # deliberately more conservative than the metadata route, which
        # does distinguish "closed" for the UI's benefit.
        if room is None or room["closed_at"] is not None:
            raise HTTPException(status_code=404, detail="Room not found")

        session_payload = _decode_session(get_session_token(request))
        # The creator can always get back into their own room without
        # the password — they're the one who set it, so re-typing it
        # every time they want to rejoin (after a dropped connection, a
        # closed tab, revisiting from "Your lounges") is pure friction
        # with no real security benefit; nobody but them can ever match
        # created_by_user_id. Guests still always need the password.
        is_host = session_payload is not None and session_payload["user_id"] == room["created_by_user_id"]

        if not is_host:
            if _is_locked(room):
                raise HTTPException(
                    status_code=429, detail="Too many incorrect attempts — try again later"
                )

            password = body.get("password") or ""
            if not verify_password(password, room["password_hash"]):
                await lounge_queries.record_failed_join_attempt(
                    conn, room["id"], max_attempts=MAX_FAILED_ATTEMPTS, lockout_minutes=LOCKOUT_MINUTES
                )
                raise HTTPException(status_code=401, detail="Incorrect password")

            await lounge_queries.reset_failed_attempts(conn, room["id"])

        # A display name is always the joiner's own choice, not silently
        # whatever their account happens to have on file — plenty of
        # Lounge visitors (including the host) have never joined a
        # league and have no meaningful display_name set. A signed-in
        # joiner who leaves it blank falls back to their account name;
        # a guest must supply one.
        raw_name = _clean_display_name(body.get("display_name") or "")
        if session_payload is not None:
            identity = f"user-{session_payload['user_id']}"
            display_name = raw_name or (
                await conn.fetchval(
                    "SELECT display_name FROM users WHERE id = $1", session_payload["user_id"]
                )
                or "Fan"
            )
        else:
            if not raw_name:
                raise HTTPException(status_code=400, detail="Display name is required")
            display_name = raw_name
            # Fresh random identity per join — never persisted, never
            # reused — since LiveKit requires unique identities within a
            # room and two different guests could otherwise type the
            # same display name.
            identity = f"guest-{secrets.token_hex(8)}"

        room_id = room["id"]

    now = int(time.time())
    livekit_room_name = f"lounge-{room_id}"
    claims = {
        "iss": api_key,
        "sub": identity,
        "name": display_name,
        "nbf": now,
        "exp": now + TOKEN_TTL_SECONDS,
        "video": {
            "room": livekit_room_name,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    token = jwt.encode(claims, api_secret, algorithm="HS256")

    return {"token": token, "url": livekit_url, "room_name": livekit_room_name, "display_name": display_name}


@router.delete("/rooms/{room_id}")
async def close_room(room_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        room = await lounge_queries.get_room(conn, room_id)
        # 404, not 403, if this isn't the caller's room — avoids
        # confirming a room id exists to someone who doesn't own it.
        if room is None or room["created_by_user_id"] != payload["user_id"]:
            raise HTTPException(status_code=404, detail="Room not found")
        await lounge_queries.close_room(conn, room_id)
    return {"status": "closed"}
