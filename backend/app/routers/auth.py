"""
Discord OAuth login. Verifies the authenticated Discord account belongs
to a real league member (owners.discord_user_id) before issuing a
session — someone outside the league can complete Discord's OAuth
consent screen, but won't get a session unless their Discord ID is
already linked to an owner.
"""
import secrets

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from app.auth import discord_oauth
from app.auth.config import DiscordAuthConfig, SessionConfig
from app.auth.session import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    create_session_token,
    create_ticket_token,
    decode_session_token,
)
from app.db import get_pool
from app.queries import auth as auth_queries

router = APIRouter(prefix="/auth", tags=["auth"])

STATE_COOKIE_NAME = "oauth_state"
STATE_COOKIE_MAX_AGE_SECONDS = 600  # just needs to survive the round trip to Discord and back


@router.get("/discord/login")
async def discord_login():
    config = DiscordAuthConfig()
    state = secrets.token_urlsafe(24)
    response = RedirectResponse(discord_oauth.build_authorize_url(config, state))
    response.set_cookie(
        STATE_COOKIE_NAME, state,
        httponly=True, max_age=STATE_COOKIE_MAX_AGE_SECONDS,
        samesite="lax", secure=config.cookie_secure,
    )
    return response


@router.get("/discord/callback")
async def discord_callback(request: Request, code: str | None = None, state: str | None = None):
    config = DiscordAuthConfig()

    expected_state = request.cookies.get(STATE_COOKIE_NAME)
    if not code or not state or not expected_state or state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    access_token = await discord_oauth.exchange_code_for_token(config, code)
    discord_user = await discord_oauth.fetch_discord_user(access_token)
    discord_user_id = int(discord_user["id"])
    discord_username = discord_user.get("username", "")

    pool = await get_pool()
    async with pool.acquire() as conn:
        owner = await auth_queries.get_owner_by_discord_id(conn, discord_user_id)
        if owner is None:
            response = RedirectResponse(f"{config.frontend_url}/login?error=not_a_league_member")
            response.delete_cookie(STATE_COOKIE_NAME)
            return response

        user_id = await auth_queries.get_or_create_user_for_owner(
            conn, owner["owner_id"], discord_user_id, discord_username
        )

    is_commissioner = (
        config.commissioner_discord_id is not None
        and str(discord_user_id) == config.commissioner_discord_id
    )
    token = create_session_token(
        config.session_secret,
        user_id=user_id,
        owner_id=owner["owner_id"],
        discord_user_id=discord_user_id,
        is_commissioner=is_commissioner,
    )

    # The session cookie set below (on THIS domain, railway.app) is what
    # every direct browser->backend call needs (AuthStatus's own /auth/me
    # poll, the chat WebSocket, chug upload, settings) — that part works
    # correctly now that it's SameSite=None; Secure. But it can never be
    # what Next.js's SERVER-SIDE rendering sees: a cookie set on
    # railway.app is never sent by the browser to a page served from
    # vercel.app, full stop, regardless of any cookie flag — that's not
    # something SameSite/Secure can fix, it's just how cookies work
    # (domain-scoped). Every page that gates on "is this visitor signed
    # in" server-side (the homepage's front door, chat, chug, settings,
    # /me/team) reads the session cookie via Next.js's own cookies() —
    # which only ever sees cookies that exist on the frontend's OWN
    # domain. So the frontend needs its own first-party copy of the same
    # token, handed off once here via the URL fragment (never sent to any
    # server, never appears in access logs or Referer headers, unlike a
    # query param) — see frontend/src/app/auth/complete/page.tsx, which
    # reads it and sets the actual first-party cookie itself.
    response = RedirectResponse(f"{config.frontend_url}/auth/complete#token={token}")
    response.delete_cookie(STATE_COOKIE_NAME)
    response.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, max_age=SESSION_MAX_AGE_SECONDS,
        samesite=config.cookie_samesite, secure=config.cookie_secure,
    )
    return response


@router.get("/me")
async def me(request: Request):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")

    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    pool = await get_pool()
    async with pool.acquire() as conn:
        owner = await conn.fetchrow(
            "SELECT display_name FROM owners WHERE owner_id = $1", payload["owner_id"]
        )

    return {
        "owner_id": payload["owner_id"],
        "display_name": owner["display_name"] if owner else None,
        "is_commissioner": payload["is_commissioner"],
    }


TICKET_PURPOSES = {"ws", "chug_upload"}


@router.post("/ticket")
async def issue_ticket(request: Request, purpose: str):
    """Mints a short-lived, purpose-scoped token (see app/auth/session.py)
    for the two real requests that can't carry the session cookie at
    all: the chat WebSocket handshake (app/routers/chat.py's chat_ws)
    and the chug video upload (app/routers/chug.py's upload_chug).
    Both are cross-site browser requests just like /auth/me used to
    be, so they hit the exact same Safari ITP cookie-blocking problem
    — but neither can be routed through the frontend's same-origin
    /api/backend proxy the way a plain fetch was (a WebSocket upgrade
    can't go through an HTTP proxy, and a real video file would count
    against Vercel's serverless body-size limit). This endpoint itself
    IS called through that same-origin proxy pattern though — the
    frontend's own auth/ticket route reads the visitor's first-party
    cookie (never touched by ITP) and forwards it here to mint the
    ticket, which the cross-site request then carries in its URL
    instead of relying on a cookie reaching it."""
    if purpose not in TICKET_PURPOSES:
        raise HTTPException(status_code=400, detail="Invalid ticket purpose")

    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")

    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    ticket = create_ticket_token(
        config.session_secret,
        purpose=purpose,
        user_id=payload["user_id"],
        owner_id=payload["owner_id"],
        discord_user_id=payload["discord_user_id"],
        is_commissioner=payload["is_commissioner"],
    )
    return {"ticket": ticket}


@router.post("/logout")
async def logout():
    # Must match the attributes the cookie was actually set with — a
    # Secure/SameSite=None cookie won't reliably clear from a delete call
    # that doesn't also specify them (the browser won't let a "weaker"
    # Set-Cookie silently override a Secure one).
    config = SessionConfig()
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE_NAME, samesite=config.cookie_samesite, secure=config.cookie_secure)
    return response
