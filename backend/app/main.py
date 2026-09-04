import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.db import get_pool
from app.routers import (
    admin,
    admin_lineup,
    auth,
    awards,
    chat,
    chug,
    commissioner_lineup,
    draft,
    feedback,
    free_agents,
    game_day,
    gamecast,
    keepers,
    league,
    league_settings,
    leagues,
    me,
    nfl,
    players,
    polls,
    profile,
    push,
    settings,
    trades,
)
from app.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Better Fantasy App API", lifespan=lifespan)

allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    # Needed so the browser sends the session cookie on cross-origin
    # requests from the frontend (different port = different origin) to
    # GET /auth/me and POST /auth/logout.
    allow_credentials=True,
)

@app.middleware("http")
async def session_revocation(request, call_next):
    """The one real check that makes logout (and account deletion)
    actually invalidate a session server-side, instead of only ever
    clearing the cookie client-side (2026-09 audit finding — a copied
    token used to stay valid for its whole 30-day life no matter what).
    A single middleware choke point rather than touching the ~19
    individual places across the app that decode a session token for
    their own payload (app/auth/session.py's own docstring) — those all
    keep working exactly as before; this only adds a new, earlier
    rejection path for the one new case ("valid signature, but this
    user's tokens were revoked after this one was issued").

    Deliberately does NOT reject an invalid/expired/missing token
    itself — that's still each route's own job, unchanged, so existing
    401 messaging never diverges. This only intervenes when the
    signature verifies fine but users.token_version has since moved on,
    or the user no longer exists at all (DELETE /auth/me). A token with
    no token_version claim (issued by the pre-2026-09 code, before this
    column/claim existed at all) is treated as version 1 — matching
    the new column's own DEFAULT — so every session already sitting in
    a visitor's browser at deploy time keeps working, not a forced
    league-wide logout.
    """
    # 2026-09 fix — real, confirmed-in-production bug, not theoretical:
    # this ran unconditionally on every request, including the
    # authentication ENTRY points themselves (/auth/discord/login,
    # /auth/login, /auth/signup, etc.). Those routes exist specifically
    # so someone whose session was revoked can get a NEW one — but a
    # stale cookie still riding along (the browser sends it regardless
    # of which endpoint actually needs it) got REJECTED by this exact
    # check before the login route's own handler ever ran, so a visitor
    # could never recover a revoked session through normal browsing at
    # all, only by wiping cookies first (nothing left to reject) or
    # using a private window (nothing to send in the first place).
    # Confirmed live via Railway logs: real GET /auth/discord/login
    # requests coming back 401 in production. Every one of these routes
    # either doesn't need an existing session at all, or (logout) must
    # stay reachable specifically WHEN the caller's session might
    # already be stale.
    AUTH_ENTRY_PATHS = {
        "/auth/discord/login", "/auth/discord/callback",
        "/auth/google/login", "/auth/google/callback",
        "/auth/login", "/auth/signup", "/auth/logout",
    }
    if request.url.path not in AUTH_ENTRY_PATHS:
        token = request.cookies.get(SESSION_COOKIE_NAME)
        if token:
            config = SessionConfig()
            payload = decode_session_token(config.session_secret, token)
            if payload is not None and "purpose" not in payload:  # real session, not a short-lived ticket
                pool = await get_pool()
                async with pool.acquire() as conn:
                    current_version = await conn.fetchval(
                        "SELECT token_version FROM users WHERE id = $1", payload["user_id"]
                    )
                if current_version is None or current_version != payload.get("token_version", 1):
                    return JSONResponse(status_code=401, content={"detail": "Session expired or invalid"})
    return await call_next(request)


@app.middleware("http")
async def security_headers(request, call_next):
    """Baseline security headers (2026-09 audit finding: none were set
    anywhere, frontend or backend). Deliberately NOT including a
    Content-Security-Policy here — this app pulls from several real
    external origins (ESPN/Sleeper image CDNs, Google Fonts, the
    frontend's own WebSocket connection back to this API) and a wrong
    CSP fails closed, silently breaking those rather than erroring
    loudly; that needs its own careful pass enumerating every real
    origin first; rushing it days before a live draft isn't worth the
    risk of breaking something. These four are safe, narrow, and can't
    break any existing functionality."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


app.include_router(admin.router)
app.include_router(admin_lineup.router)
app.include_router(auth.router)
app.include_router(awards.router)
app.include_router(chat.router)
app.include_router(chug.router)
app.include_router(commissioner_lineup.router)
app.include_router(draft.router)
app.include_router(feedback.router)
app.include_router(free_agents.router)
app.include_router(game_day.router)
app.include_router(gamecast.router)
app.include_router(keepers.router)
app.include_router(league.router)
app.include_router(league_settings.router)
app.include_router(leagues.router)
app.include_router(me.router)
app.include_router(nfl.router)
app.include_router(players.router)
app.include_router(polls.router)
app.include_router(profile.router)
app.include_router(push.router)
app.include_router(settings.router)
app.include_router(trades.router)


@app.get("/health")
async def health(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok"}
