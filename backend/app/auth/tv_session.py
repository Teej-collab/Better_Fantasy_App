"""What a paired TV's session may do (The Weekend TV, 2026-11-14 — see
app/routers/tv.py). A TV token is an ordinary session token with a
`tv_device_id` claim, so every read route already works for it; this is
the one place that keeps it a watch-only session. Called from
app/main.py's session_revocation middleware, after the account-wide
token_version check has already passed."""
from fastapi.responses import JSONResponse

_READ_METHODS = {"GET", "HEAD", "OPTIONS"}

# The only writes a TV makes: refreshing its own token.
_TV_WRITE_PATHS = {"/tv/refresh"}

# Never readable from a TV, even with a valid token: site admin, and the
# account's own TV list (the website manages TVs, not a TV).
_TV_BLOCKED_PREFIXES = ("/admin", "/tv/devices", "/tv/pair/approve")

# last_seen_at is a "when did this TV last check in" hint for the TV
# list, not an audit log: one write per few minutes is plenty.
_LAST_SEEN_EVERY_SECONDS = 300


def tv_request_allowed(method: str, path: str) -> bool:
    if path.startswith(_TV_BLOCKED_PREFIXES):
        return False
    return method in _READ_METHODS or path in _TV_WRITE_PATHS


async def tv_session_rejection(pool, payload: dict, method: str, path: str) -> JSONResponse | None:
    if not tv_request_allowed(method, path):
        return JSONResponse(status_code=403, content={"detail": "A TV can only watch"})
    async with pool.acquire() as conn:
        device = await conn.fetchrow(
            """
            SELECT last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => $3) AS stale
              FROM tv_devices
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
            """,
            payload["tv_device_id"], payload["user_id"], _LAST_SEEN_EVERY_SECONDS,
        )
        if device is None:
            return JSONResponse(status_code=401, content={"detail": "This TV was disconnected"})
        if device["stale"]:
            await conn.execute("UPDATE tv_devices SET last_seen_at = now() WHERE id = $1", payload["tv_device_id"])
    return None
