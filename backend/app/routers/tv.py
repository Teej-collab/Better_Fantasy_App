"""
The Weekend TV (2026-11-14): pairing a Chromecast with Google TV, and
the account's list of paired TVs.

Pairing is the usual TV sign-in (the device-code pattern): the TV asks
for a code (POST /tv/pair/start) and shows it; a signed-in member types
it on the website (POST /tv/pair/approve); the TV, polling with the
secret device_code only it holds (POST /tv/pair/token), then gets its
own session token, once. No password ever goes near the TV.

A TV's token is read-only and dies the moment its row is disconnected —
app/auth/tv_session.py, enforced in app/main.py's middleware.
"""
import asyncio
import hashlib
import json
import secrets
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import tv_live
from app.domain import announcements
from app.auth.config import SessionConfig
from app.auth.league_context import resolve_active_league_id
from app.auth.rate_limit import check_tv_pairing_rate_limit
from app.auth.session import create_tv_session_token, decode_session_token, get_session_token
from app.db import get_pool
from app.queries import auth as auth_queries

router = APIRouter(prefix="/tv", tags=["tv"])

# No 0/O or 1/I: the code is read off a TV across the room.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 8
_CODE_TTL_SECONDS = 10 * 60
_POLL_INTERVAL_SECONDS = 5


def new_pairing_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


def normalize_code(raw: str) -> str:
    """What someone types: any case, with or without the dash or spaces."""
    return "".join(ch for ch in raw.upper() if ch.isalnum())


def _hash(device_code: str) -> str:
    return hashlib.sha256(device_code.encode()).hexdigest()


def _payload(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


class PairStart(BaseModel):
    device_name: str = Field("TV", min_length=1, max_length=60)


class PairApprove(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)


class PairToken(BaseModel):
    device_code: str = Field(..., min_length=20, max_length=200)


@router.post("/pair/start")
async def pair_start(body: PairStart, request: Request):
    check_tv_pairing_rate_limit("start", request.client.host if request.client else "unknown")
    device_code = secrets.token_urlsafe(32)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM tv_pairing_codes WHERE expires_at < now() - interval '1 day'")
        for _ in range(5):  # a collision on a live code is astronomically rare; retry anyway
            code = new_pairing_code()
            inserted = await conn.fetchval(
                """
                INSERT INTO tv_pairing_codes (code, device_code_hash, device_name, expires_at)
                VALUES ($1, $2, $3, now() + make_interval(secs => $4))
                ON CONFLICT (code) DO NOTHING
                RETURNING code
                """,
                code, _hash(device_code), body.device_name.strip(), _CODE_TTL_SECONDS,
            )
            if inserted:
                break
        else:
            raise HTTPException(status_code=503, detail="Couldn't make a code, try again")
    return {
        "code": code,
        "device_code": device_code,
        "expires_in": _CODE_TTL_SECONDS,
        "interval": _POLL_INTERVAL_SECONDS,
    }


@router.post("/pair/approve")
async def pair_approve(body: PairApprove, request: Request):
    payload = _payload(request)
    if "tv_device_id" in payload:
        raise HTTPException(status_code=403, detail="Approve from your phone or computer")
    check_tv_pairing_rate_limit("approve", str(payload["user_id"]))
    code = normalize_code(body.code)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE tv_pairing_codes
               SET approved_user_id = $2, approved_at = now()
             WHERE code = $1 AND expires_at > now() AND approved_user_id IS NULL
            RETURNING device_name
            """,
            code, payload["user_id"],
        )
    if row is None:
        raise HTTPException(status_code=404, detail="That code didn't work. Check the TV for a fresh one.")
    return {"device_name": row["device_name"]}


@router.post("/pair/token")
async def pair_token(body: PairToken):
    """Polled by the TV. `pending` until someone approves the code; then
    the token, exactly once — a second redeem finds redeemed_at set."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT code, device_name, approved_user_id, redeemed_at, expires_at > now() AS live
                  FROM tv_pairing_codes WHERE device_code_hash = $1 FOR UPDATE
                """,
                _hash(body.device_code),
            )
            if row is None or row["redeemed_at"] is not None:
                raise HTTPException(status_code=404, detail="Unknown code")
            if row["approved_user_id"] is None:
                if not row["live"]:
                    raise HTTPException(status_code=410, detail="Code expired")
                return {"status": "pending"}
            user_id = row["approved_user_id"]
            device_id = await conn.fetchval(
                "INSERT INTO tv_devices (user_id, name, last_seen_at) VALUES ($1, $2, now()) RETURNING id",
                user_id, row["device_name"],
            )
            await conn.execute(
                "UPDATE tv_pairing_codes SET redeemed_at = now(), device_id = $2 WHERE code = $1",
                row["code"], device_id,
            )
            token_version = await conn.fetchval("SELECT token_version FROM users WHERE id = $1", user_id)
            owner_id = await auth_queries.get_owner_id_for_user(conn, user_id)
    token = create_tv_session_token(
        SessionConfig().session_secret, user_id=user_id, owner_id=owner_id,
        device_id=device_id, token_version=token_version,
    )
    return {"status": "ok", "token": token, "device_id": device_id}


@router.post("/refresh")
async def refresh(request: Request):
    """A fresh 90-day token for the TV calling (the middleware has already
    checked it's a live TV). Also picks up a changed owner link."""
    payload = _payload(request)
    if "tv_device_id" not in payload:
        raise HTTPException(status_code=403, detail="Only a TV refreshes here")
    pool = await get_pool()
    async with pool.acquire() as conn:
        token_version = await conn.fetchval("SELECT token_version FROM users WHERE id = $1", payload["user_id"])
        owner_id = await auth_queries.get_owner_id_for_user(conn, payload["user_id"])
    token = create_tv_session_token(
        SessionConfig().session_secret, user_id=payload["user_id"], owner_id=owner_id,
        device_id=payload["tv_device_id"], token_version=token_version,
    )
    return {"token": token}


@router.get("/me")
async def me(request: Request):
    """Who this TV is signed in as, for the TV's settings screen."""
    payload = _payload(request)
    if "tv_device_id" not in payload:
        raise HTTPException(status_code=403, detail="Only a TV asks this")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT d.id, d.name, d.created_at, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)) AS display_name
              FROM tv_devices d JOIN users u ON u.id = d.user_id
             WHERE d.id = $1
            """,
            payload["tv_device_id"],
        )
    return {"device_id": row["id"], "name": row["name"], "paired_at": row["created_at"], "account": row["display_name"]}


@router.get("/commish-post")
async def commish_post(request: Request):
    """The commissioner's latest Commish Corner announcement, for the TV's
    Lounge. Members already read these in the Corner itself; this is just
    the newest one without the chat around it. `post` is null when there
    isn't one."""
    payload = _payload(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, payload)
        posts = await announcements.list_recent_posts(conn, league_id, limit=1) if league_id is not None else []
    return {"post": posts[0] if posts else None}


_PING_SECONDS = 15
_RECHECK_SECONDS = 60


@router.get("/live")
async def live(request: Request):
    """The TV's live line (Server-Sent Events): `scores` when its league's
    numbers move, `touchdown` when a starter scores — see app/tv_live.py.
    A comment line every 15 s keeps proxies from closing it, and the
    device is re-checked every minute so a disconnect ends the stream."""
    payload = _payload(request)
    if "tv_device_id" not in payload:
        raise HTTPException(status_code=403, detail="Only a TV listens here")
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, payload)
    if league_id is None:
        raise HTTPException(status_code=409, detail="No active league selected")

    async def stream():
        q = tv_live.subscribe(league_id)
        last_check = time.monotonic()
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(q.get(), timeout=_PING_SECONDS)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                if time.monotonic() - last_check > _RECHECK_SECONDS:
                    last_check = time.monotonic()
                    async with pool.acquire() as conn:
                        alive = await conn.fetchval(
                            "SELECT 1 FROM tv_devices WHERE id = $1 AND revoked_at IS NULL", payload["tv_device_id"],
                        )
                    if not alive:
                        return
        finally:
            tv_live.unsubscribe(league_id, q)

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---- phone to TV ----

_SCREENS = {"home", "matchup", "redzone", "league", "lounge", "scores", "gamecast"}
# "menu" is the overlay button: the overlay's menu over whatever is playing.
_KEYS = {"up", "down", "left", "right", "ok", "back", "home", "playpause", "menu"}


class SendToTv(BaseModel):
    # "open": bring a screen up (game_id with gamecast); "key": one remote press.
    kind: str = Field(..., pattern="^(open|key)$")
    screen: str | None = None
    game_id: str | None = Field(None, max_length=20)
    key: str | None = None


@router.post("/send")
async def send_to_tv(body: SendToTv, request: Request):
    """The phone's "Send to TV" and remote: hands one command to every TV
    the signed-in account has listening (GET /tv/remote). A TV can't call
    this (its token only reads). `delivered` is how many TVs got it, so the
    phone can say when none is on."""
    payload = _payload(request)
    if body.kind == "open":
        if body.screen not in _SCREENS or (body.screen == "gamecast" and not body.game_id):
            raise HTTPException(status_code=400, detail="Unknown screen")
        event = {"type": "open", "screen": body.screen, "game_id": body.game_id}
    else:
        if body.key not in _KEYS:
            raise HTTPException(status_code=400, detail="Unknown key")
        event = {"type": "key", "key": body.key}
    return {"delivered": tv_live.send_to_account(payload["user_id"], event)}


@router.get("/remote")
async def remote(request: Request):
    """A TV's line for its account's phone (Server-Sent Events): `open` and
    `key` from POST /tv/send. Held by the TV's remote service, which can
    press buttons in any app. Same keep-alive and disconnect check as
    /tv/live."""
    payload = _payload(request)
    if "tv_device_id" not in payload:
        raise HTTPException(status_code=403, detail="Only a TV listens here")
    pool = await get_pool()

    async def stream():
        q = tv_live.subscribe_remote(payload["user_id"])
        last_check = time.monotonic()
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(q.get(), timeout=_PING_SECONDS)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                if time.monotonic() - last_check > _RECHECK_SECONDS:
                    last_check = time.monotonic()
                    async with pool.acquire() as conn:
                        alive = await conn.fetchval(
                            "SELECT 1 FROM tv_devices WHERE id = $1 AND revoked_at IS NULL", payload["tv_device_id"],
                        )
                    if not alive:
                        return
        finally:
            tv_live.unsubscribe_remote(payload["user_id"], q)

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/devices")
async def list_devices(request: Request):
    payload = _payload(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, created_at, last_seen_at FROM tv_devices
             WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC
            """,
            payload["user_id"],
        )
    return {"devices": [dict(r) for r in rows]}


@router.delete("/devices/{device_id}")
async def disconnect_device(device_id: int, request: Request):
    payload = _payload(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        done = await conn.fetchval(
            "UPDATE tv_devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
            device_id, payload["user_id"],
        )
    if done is None:
        raise HTTPException(status_code=404, detail="TV not found")
    return {"ok": True}
