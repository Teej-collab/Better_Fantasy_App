"""Resolves which league a request is scoped to (see TODO.md's PHASE 9
entry — "session-resolved active league"). Deliberately never accepts
a league_id from the request itself (a URL, query param, or body) —
only ever derived from the signed-in session's user_id, so a visitor
can never see another league's data by editing a request. The only
way `users.active_league_id` changes is POST /leagues/{id}/select
(app/routers/leagues.py), which verifies real membership first.
"""
from fastapi import HTTPException

from app.config import DEFAULT_LEAGUE_ID
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
