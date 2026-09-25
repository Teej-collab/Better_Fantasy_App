"""
Session as a signed JWT in an httpOnly cookie. Still no full server-
side session table, but real revocation exists as of 2026-09 via a
single `token_version` claim (see create_session_token) checked against
users.token_version by app/main.py's session_revocation middleware —
bumping that column invalidates every token issued before the bump at
once. decode_session_token itself deliberately stays pure crypto (no
DB): the middleware is the one place that adds the DB-backed check, so
none of the ~19 call sites that decode a token for their own payload
needed to change.
"""
import time

import jwt

SESSION_COOKIE_NAME = "session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days

# Short-lived, purpose-scoped tokens for the two real requests that
# can't carry the session cookie at all: the chat WebSocket handshake
# and the chug video upload from a browser affected by Safari's ITP
# (blocks third-party cookies on any cross-site request, cookie flags
# notwithstanding — see frontend/src/app/auth/ticket/route.ts for the
# full reasoning). A visitor mints one via their own first-party
# cookie (which ITP never touches), then hands it to the cross-site
# request in the URL instead of relying on a cookie reaching it.
# 60 seconds is only meant to survive the handshake starting, not the
# whole request — well short of anything replay-worthy.
TICKET_MAX_AGE_SECONDS = 60

# The chug upload ticket needs to survive the ENTIRE file transfer, not
# just "starting" it, unlike the WS handshake above — FastAPI's
# UploadFile = File(...) parameter means Starlette fully receives the
# request body before upload_chug's own handler (and its ticket check)
# ever runs, so a short-lived ticket here is judged against how long
# the WHOLE upload took, not how long it took to begin. 2026-09-10 real
# incident: a real upload 401'd with "Not signed in" 61 seconds after
# minting its ticket — one second past the 60s meant for a quick
# handshake, not a video transfer over a real phone connection.
# 15 minutes matches Railway's own absolute request cap (see
# app/routers/chug.py's upload_chug docstring) — no point outliving a
# limit the platform itself enforces regardless.
CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS = 15 * 60

# A Watch Party WS connection is meant to stay open for an entire real
# sitting (a game slate), not a handshake or a bounded upload — same
# reasoning already applied to that room's LiveKit video token (see
# app/routers/watch_party.py's TOKEN_TTL_SECONDS comment). The frontend
# re-mints a fresh ticket well before this expires rather than this
# trying to outlive an entire Sunday in one token.
WATCH_PARTY_WS_TICKET_MAX_AGE_SECONDS = 6 * 60 * 60


def create_session_token(
    secret: str, *, user_id: int, owner_id: int | None = None, discord_user_id: int | None = None,
    is_commissioner: bool = False, token_version: int = 1,
) -> str:
    """owner_id/discord_user_id/is_commissioner are all optional now
    (Phase 5 of the multi-league migration — see TODO.md's PHASE 9
    entry): they describe this account's link to League #1 specifically
    (owners.discord_user_id, the commissioner flag), which a self-serve
    email/password signup has none of yet — user_id is the only thing
    every real Weekend account actually has.

    token_version defaults to 1 to match users.token_version's own
    column default (migration c4613ad6cdee) — every real caller in this
    app's login/signup/OAuth routes fetches the account's actual current
    value and passes it explicitly; the default here only matters for
    tests and any other caller that hasn't been taught about revocation
    at all, which should still produce a token that validates against a
    freshly-created account's default column value."""
    payload = {
        "user_id": user_id,
        "owner_id": owner_id,
        "discord_user_id": discord_user_id,
        "is_commissioner": is_commissioner,
        "token_version": token_version,
        "exp": int(time.time()) + SESSION_MAX_AGE_SECONDS,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_session_token(secret: str, token: str) -> dict | None:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def create_ticket_token(
    secret: str, *, purpose: str, user_id: int, owner_id: int, discord_user_id: int, is_commissioner: bool,
    max_age_seconds: int = TICKET_MAX_AGE_SECONDS, jti: str | None = None,
) -> str:
    """jti (JWT ID) is optional and omitted by default — every existing
    ticket purpose (ws, chug_upload, watch_party_ws) keeps working
    unchanged. It exists for a purpose that needs single-use redemption
    enforced server-side (native_oauth — see app/routers/auth.py's
    redeem_native_oauth_ticket, which records a jti the first time it's
    redeemed and rejects a second redemption of the same one); a plain
    short expiry is enough for the other purposes, which were never
    meant to be redeemed exactly once."""
    payload = {
        "user_id": user_id,
        "owner_id": owner_id,
        "discord_user_id": discord_user_id,
        "is_commissioner": is_commissioner,
        "purpose": purpose,
        "exp": int(time.time()) + max_age_seconds,
    }
    if jti is not None:
        payload["jti"] = jti
    return jwt.encode(payload, secret, algorithm="HS256")


def get_session_token(request) -> str | None:
    """Returns the session token from an `Authorization: Bearer <token>`
    header if present, else from the session cookie. Added for a native
    client (iOS/Android — no shared cookie jar with this app's browser
    frontend), which can already get a token from /auth/login's and
    /auth/signup's own JSON body (`{"token": ...}`, already returned
    alongside the Set-Cookie for exactly this reason) and send it back
    as a header instead of relying on a cookie. An explicit header
    always wins over a stray cookie if a caller somehow sent both.
    Every call site that used to read
    request.cookies.get(SESSION_COOKIE_NAME) directly should go through
    this instead, so bearer-token support is one change, not ~20 — see
    app/main.py's session_revocation middleware, which also goes
    through this, so revocation applies to a bearer token exactly the
    same as a cookie."""
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header[len("Bearer "):].strip() or None
    return request.cookies.get(SESSION_COOKIE_NAME)


def decode_ticket_token(secret: str, token: str, expected_purpose: str) -> dict | None:
    """Same secret as a real session token, deliberately — a ticket is
    just a session token with a `purpose` claim and a much shorter
    expiry, so no full session token can ever be replayed as a ticket
    (it has no `purpose` claim, real or forged without the secret) and
    a ticket for one purpose can't be reused for another."""
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != expected_purpose:
        return None
    return payload
