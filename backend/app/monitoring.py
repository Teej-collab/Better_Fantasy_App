"""
Error, security, and admin-audit capture for the admin dashboard
(ADMIN_DASHBOARD.md — the Errors, Security, and Audit Log pages).

One middleware (`monitoring_middleware`, registered last in app/main.py
so it's outermost and sees every response) records:

- server errors: any unhandled exception (with its traceback) or 5xx
  response, into app_errors;
- security events: 403 (blocked) and 429 (rate-limited) responses, and
  401s from the token-redeeming auth endpoints, into security_events.
  Failed password sign-ins are recorded by POST /auth/login itself
  (record_failed_login), since only it knows which email was tried;
- the admin audit log: every successful non-GET request under /admin
  (except the analytics/error intake endpoints anyone can call), into
  admin_audit_log. An endpoint can add detail the URL doesn't carry
  (e.g. grant vs. revoke) by setting request.state.audit_detail.

Every write happens in a background task on its own pooled connection
and swallows its own failures — monitoring must never slow down or break
the request it's watching.
"""
import asyncio
import hashlib
import logging
import re
import time
import traceback

from fastapi import Request

from app.auth.config import SessionConfig
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool

logger = logging.getLogger(__name__)

MAX_MESSAGE = 500
MAX_STACK = 4000
MAX_FIELD = 200

# Admin endpoints anyone signed in (or anyone at all) calls as a side
# effect of using the app — not admin actions, so never audited.
_AUDIT_EXEMPT_PATHS = {"/admin/track", "/admin/client-error"}

# Auth endpoints where a 401 means someone presented a bad or reused
# token — worth a security event. A 401 anywhere else is just a signed-
# out visitor, which is normal traffic.
_TOKEN_ENDPOINTS = {"/auth/native/redeem", "/auth/reset-password"}

# Plain-English names for the admin actions the audit log shows, keyed
# by "METHOD route-template". Anything missing falls back to the raw
# method + path, so a new admin endpoint is still logged, just less
# readably.
AUDIT_ACTION_LABELS = {
    "POST /admin/sync": "Ran ESPN sync",
    "POST /admin/sync/live": "Ran live score sync",
    "POST /admin/weekly-compute": "Recomputed weekly stats",
    "POST /admin/waivers/process": "Processed waivers",
    "POST /admin/playoffs/generate": "Generated playoff bracket",
    "POST /admin/playoffs/resolve": "Resolved playoff matchups",
    "DELETE /admin/teams/{team_id}": "Deleted a team",
    "POST /admin/weekly-team-stats": "Recomputed weekly team stats",
    "POST /admin/sync/bye-weeks": "Synced bye weeks",
    "POST /admin/players/sync": "Synced players",
    "POST /admin/players/sync-projections": "Synced projections",
    "PATCH /admin/users/{user_id}/admin": "Changed admin access",
    "DELETE /admin/users/{user_id}": "Deleted a user",
    "POST /admin/lineup/teams/{team_id}/set": "Set a lineup",
    "POST /admin/lineup/teams/{team_id}/swap": "Swapped lineup slots",
}


def is_test_request(request: Request) -> bool:
    """The backend test suite runs against the production database
    (tests/conftest.py) through httpx's ASGITransport, whose requests
    all carry the fake host "test". Its deliberate 403s, bad logins,
    and sample errors must not show up as real events or page the
    admins."""
    return request.url.hostname == "test"


def client_ip(request: Request) -> str | None:
    """The real caller's IP. Railway's proxy puts it first in
    X-Forwarded-For; request.client is the proxy itself there."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64] or None
    return request.client.host if request.client else None


def session_user_id(request: Request) -> int | None:
    token = get_session_token(request)
    if not token:
        return None
    try:
        payload = decode_session_token(SessionConfig().session_secret, token)
    except Exception:
        return None
    if not payload or "purpose" in payload:
        return None
    return payload.get("user_id")


# Quotes only count when they open after a non-word character, so the
# apostrophe in "can't" isn't mistaken for the start of a quoted value.
_VOLATILE = re.compile(r"0x[0-9a-f]+|\b[0-9a-f]{8,}\b|\d+|\B'[^']*'|\B\"[^\"]*\"", re.IGNORECASE)


def fingerprint(source: str, message: str, where: str | None) -> str:
    """Groups repeats of one bug: the message with ids, numbers, and
    quoted values blanked out, plus where it happened (the route with
    its own ids blanked the same way). Two different players' ids in
    "Cannot read 'x' of player 1234" are still one bug."""
    normalized = _VOLATILE.sub("_", message.strip().lower())[:300]
    place = _VOLATILE.sub("_", (where or "").lower())
    return hashlib.sha1(f"{source}|{normalized}|{place}".encode()).hexdigest()[:16]


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    value = str(value)
    return value if len(value) <= limit else value[:limit]


def run_in_background(coro) -> None:
    async def runner():
        try:
            await coro
        except Exception:
            logger.warning("Monitoring write failed", exc_info=True)

    try:
        asyncio.get_running_loop().create_task(runner())
    except RuntimeError:
        coro.close()


# ---------------------------------------------------------------- writes


async def insert_error(
    conn,
    *,
    source: str,
    message: str,
    stack: str | None,
    route: str | None,
    method: str | None = None,
    status_code: int | None = None,
    owner_id: int | None = None,
    user_id: int | None = None,
    platform: str | None = None,
    os: str | None = None,
    screen: str | None = None,
) -> str:
    """Inserts one error row and returns its fingerprint."""
    message = _clip(message, MAX_MESSAGE) or "Unknown error"
    fp = fingerprint(source, message, route)
    await conn.execute(
        """
        INSERT INTO app_errors
            (source, fingerprint, message, stack, route, method, status_code,
             owner_id, user_id, platform, os, screen)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        """,
        source, fp, message, _clip(stack, MAX_STACK), _clip(route, MAX_FIELD), method, status_code,
        owner_id, user_id, _clip(platform, 20), _clip(os, 40), _clip(screen, 40),
    )
    return fp


async def _record_server_error(message, stack, route, method, status_code, user_id) -> None:
    from app.notifications import admin_alerts

    pool = await get_pool()
    async with pool.acquire() as conn:
        fp = await insert_error(
            conn, source="server", message=message, stack=stack, route=route,
            method=method, status_code=status_code, user_id=user_id,
        )
        await admin_alerts.maybe_alert_error(conn, fp)


async def insert_security_event(
    conn, *, kind: str, user_id=None, email=None, ip=None, method=None, path=None, detail=None, user_agent=None
) -> None:
    await conn.execute(
        """
        INSERT INTO security_events (kind, user_id, email, ip, method, path, detail, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        kind, user_id, _clip(email, MAX_FIELD), ip, method, _clip(path, MAX_FIELD),
        _clip(detail, MAX_FIELD), _clip(user_agent, MAX_FIELD),
    )


async def _record_security_event(**fields) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await insert_security_event(conn, **fields)


def record_failed_login(request: Request, email: str) -> None:
    """Called by POST /auth/login on a wrong email/password — the one
    place that knows which email was tried. Also checks for a burst
    (many failures from one IP or against one account) and alerts."""
    if is_test_request(request):
        return
    ip = client_ip(request)

    async def write():
        from app.notifications import admin_alerts

        pool = await get_pool()
        async with pool.acquire() as conn:
            await insert_security_event(
                conn, kind="login_failed", email=email, ip=ip, method="POST", path="/auth/login",
                user_agent=request.headers.get("user-agent"),
            )
            await admin_alerts.maybe_alert_login_burst(conn, ip, email)

    run_in_background(write())


async def _record_audit(actor_user_id, action, method, path, target, status_code) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO admin_audit_log (actor_user_id, action, method, path, target, status_code)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            actor_user_id, action, method, _clip(path, MAX_FIELD), _clip(target, MAX_FIELD), status_code,
        )


# ------------------------------------------------------------ middleware


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", None) or request.url.path


async def monitoring_middleware(request: Request, call_next):
    if is_test_request(request):
        return await call_next(request)
    method = request.method
    path = request.url.path
    try:
        response = await call_next(request)
    except Exception as exc:
        run_in_background(_record_server_error(
            f"{type(exc).__name__}: {exc}", traceback.format_exc(), _route_template(request),
            method, 500, session_user_id(request),
        ))
        raise

    status = response.status_code
    if status >= 500:
        run_in_background(_record_server_error(
            f"{status} response from {method} {_route_template(request)}", None, _route_template(request),
            method, status, session_user_id(request),
        ))
    elif status in (403, 429) or (status == 401 and path in _TOKEN_ENDPOINTS):
        kind = {403: "forbidden", 429: "rate_limited", 401: "invalid_token"}[status]
        run_in_background(_record_security_event(
            kind=kind, user_id=session_user_id(request), ip=client_ip(request), method=method, path=path,
            user_agent=request.headers.get("user-agent"),
        ))

    if (
        method != "GET"
        and 200 <= status < 300
        and path.startswith("/admin/")
        and path not in _AUDIT_EXEMPT_PATHS
    ):
        template = _route_template(request)
        action = AUDIT_ACTION_LABELS.get(f"{method} {template}", f"{method} {template}")
        detail = getattr(request.state, "audit_detail", None)
        params = ", ".join(f"{k} {v}" for k, v in request.path_params.items())
        target = " · ".join(p for p in (params, detail) if p) or None
        run_in_background(_record_audit(session_user_id(request), action, method, path, target, status))

    return response


# ------------------------------------------------------ intake rate limit

_CLIENT_ERROR_WINDOW_SECONDS = 600
_CLIENT_ERROR_MAX = 30
_client_error_hits: dict[str, list[float]] = {}


def client_error_rate_limited(key: str) -> bool:
    """In-memory, per-IP cap on POST /admin/client-error — it's open to
    signed-out visitors, so it needs its own abuse ceiling."""
    now = time.monotonic()
    hits = [t for t in _client_error_hits.get(key, []) if now - t < _CLIENT_ERROR_WINDOW_SECONDS]
    if len(hits) >= _CLIENT_ERROR_MAX:
        _client_error_hits[key] = hits
        return True
    hits.append(now)
    _client_error_hits[key] = hits
    if len(_client_error_hits) > 5000:
        _client_error_hits.clear()
    return False
