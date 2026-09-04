"""Resolves which league a request is scoped to (see TODO.md's PHASE 9
entry — "session-resolved active league"). Deliberately never accepts
a league_id from the request itself (a URL, query param, or body) —
only ever derived from the signed-in session's user_id, so a visitor
can never see another league's data by editing a request. The only
way `users.active_league_id` changes is POST /leagues/{id}/select
(app/routers/leagues.py), which verifies real membership first.
"""
from fastapi import Depends, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.db import get_pool
from app.queries import leagues as league_queries


async def resolve_active_league_id(conn, payload: dict | None) -> int:
    """For read-mostly, public-preview-friendly routes (standings,
    awards, free agents, game day): signed-out, or signed-in but
    without an active league selected yet, both fall back to the real
    public default (League #1) rather than erroring — same as this
    app's behavior before per-user league selection existed."""
    if payload is None:
        return DEFAULT_LEAGUE_ID
    active = await league_queries.get_active_league_id(conn, payload["user_id"])
    return active if active is not None else DEFAULT_LEAGUE_ID


async def require_active_league_id(conn, payload: dict) -> int:
    """For routes that are already session-gated and show genuinely
    personal data (My Team, Draft, Keepers, Chug, Settings, Admin) —
    a signed-in visitor with no active league yet gets a clear signal
    to go pick one, never a silent fallback to someone else's league."""
    active = await league_queries.get_active_league_id(conn, payload["user_id"])
    if active is None:
        raise HTTPException(status_code=409, detail="No active league selected")
    return active


async def require_commissioner_of(conn, payload: dict, league_id: int) -> None:
    """Verifies the caller is THIS specific league's commissioner —
    replaces the old global, JWT-cached `is_commissioner` claim
    (previously set once at login from a single COMMISSIONER_DISCORD_ID
    env var) with a live per-league check, required now that more than
    one league can exist, each with its own commissioner."""
    membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
    if membership is None or membership["role"] != "commissioner":
        raise HTTPException(status_code=403, detail="Commissioner only")


async def is_site_admin(conn, user_id: int) -> bool:
    """True for League #1's commissioner (the original, implicit
    grant — see is_site_owner's history on /auth/me) OR anyone with
    users.is_admin set directly (2026-09, so the real owner can grant
    admin-dashboard access to someone else — Niko — without also
    handing them full League #1 commissioner power, a much bigger
    grant). Either is sufficient on its own."""
    membership = await league_queries.get_membership(conn, DEFAULT_LEAGUE_ID, user_id)
    if membership is not None and membership["role"] == "commissioner":
        return True
    return bool(await conn.fetchval("SELECT is_admin FROM users WHERE id = $1", user_id))


async def require_site_admin(conn, payload: dict) -> None:
    """The real gate every /admin/* endpoint uses (see
    app/routers/admin.py) — same two-clause check as is_site_admin
    above, raising 403 instead of returning False."""
    if not await is_site_admin(conn, payload["user_id"]):
        raise HTTPException(status_code=403, detail="Admin only")


async def require_league_commissioner(conn, payload: dict) -> int:
    """Like require_active_league_id, but also verifies the caller is
    THEIR ACTIVE league's commissioner. Returns the resolved league_id
    so callers don't need to look it up twice. Use this for actions
    scoped to "whichever league I'm currently using" (draft setup,
    keeper rules, lineup admin). For actions tied to one specific
    league regardless of what the caller has active — like League #1's
    ESPN sync, which only ever affects League #1 — use
    require_commissioner_of with an explicit league_id instead."""
    league_id = await require_active_league_id(conn, payload)
    await require_commissioner_of(conn, payload, league_id)
    return league_id


def _decode_session_or_401(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


async def require_league_access(request: Request, pool=Depends(get_pool)) -> int:
    """FastAPI dependency for genuinely league-private read data —
    standings, matchups, rosters, rivalries, awards, records, power
    rankings, owner profiles, chug leaderboard. Requires a real signed-
    in session AND real active-league membership (via
    require_active_league_id), returning the resolved league_id.

    2026-09 finding: app/routers/league.py, profile.py, and awards.py
    had NO auth at all — any signed-in account (including one that had
    never joined any league) could read another league's full
    standings/rosters/rivalries, because "single private league, no
    self-serve signup" was true when those routers were written and
    silently stopped being true once self-serve email/Discord/Google
    signup and multi-league support shipped. Deny-by-default is the
    correct default for this class of data now; use
    resolve_active_league_id's signed-out-friendly fallback only for
    data that's genuinely meant to be public regardless of membership
    (there is currently no such data in this app)."""
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        return await require_active_league_id(conn, payload)
