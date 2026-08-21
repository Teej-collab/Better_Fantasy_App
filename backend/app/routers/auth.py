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

    response = RedirectResponse(config.frontend_url)
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
