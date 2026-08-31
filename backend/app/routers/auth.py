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
from pydantic import BaseModel

from app.auth import discord_oauth
from app.auth.config import DiscordAuthConfig, SessionConfig
from app.auth.passwords import MIN_PASSWORD_LENGTH, hash_password, verify_password
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
        display_name = None
        if payload.get("owner_id") is not None:
            owner = await conn.fetchrow(
                "SELECT display_name FROM owners WHERE owner_id = $1", payload["owner_id"]
            )
            display_name = owner["display_name"] if owner else None
        if display_name is None:
            # Either a password account (no owner link at all yet), or
            # a Discord account whose owner row somehow has no name —
            # users.display_name is the account's own name, independent
            # of any league membership (see migration 1149bed021a5).
            user = await conn.fetchrow("SELECT display_name FROM users WHERE id = $1", payload["user_id"])
            display_name = user["display_name"] if user else None

    return {
        "owner_id": payload["owner_id"],
        "display_name": display_name,
        "is_commissioner": payload["is_commissioner"],
    }


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/signup")
async def signup(body: SignupRequest, response: Response):
    """A second, independent way to get a real Weekend account,
    alongside Discord — not a replacement for it (Phase 5 of the
    multi-league migration, see TODO.md's PHASE 9 entry). Deliberately
    does not create or link an owners row: this account has no league
    yet, the same way a brand-new Discord-linked owner did before their
    first login — that only happens once they create or join a league
    (a later phase). Known limitation, not solved here: an existing
    Discord user who signs up again with their real-life email gets a
    genuinely separate account (no automatic linking/merging yet)."""
    email = _normalize_email(body.email)
    if "@" not in email or len(email) < 5:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    display_name = body.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Enter a display name")

    config = SessionConfig()
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await auth_queries.get_user_by_email(conn, email)
        if existing is not None:
            raise HTTPException(status_code=409, detail="An account with that email already exists")
        user_id = await auth_queries.create_user_with_password(conn, email, hash_password(body.password), display_name)

    # No owner_id/discord_user_id/is_commissioner — this account has no
    # League #1 link at all (see docstring above).
    token = create_session_token(config.session_secret, user_id=user_id)
    # Same-domain cookie for direct browser->backend calls (chat WS,
    # chug upload) — the frontend still needs its own first-party copy,
    # handed the returned token the same way the Discord flow's
    # /auth/complete page does (see that page's own docstring).
    response.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, max_age=SESSION_MAX_AGE_SECONDS,
        samesite=config.cookie_samesite, secure=config.cookie_secure,
    )
    return {"token": token}


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    email = _normalize_email(body.email)
    config = SessionConfig()
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await auth_queries.get_user_by_email(conn, email)

    # One generic error for "no such account," "this account has no
    # password set (Discord-only)," and "wrong password" — never lets a
    # login attempt reveal which of those it was, matching this app's
    # existing account-enumeration posture on the Discord side (a
    # non-member gets the same denial regardless of why).
    invalid = HTTPException(status_code=401, detail="Invalid email or password")
    if user is None or user["password_hash"] is None:
        raise invalid
    if not verify_password(body.password, user["password_hash"]):
        raise invalid

    token = create_session_token(config.session_secret, user_id=user["id"])
    response.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, max_age=SESSION_MAX_AGE_SECONDS,
        samesite=config.cookie_samesite, secure=config.cookie_secure,
    )
    return {"token": token}


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
