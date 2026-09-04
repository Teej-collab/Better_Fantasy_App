"""
Commissioner-only endpoints. Every one of these is inherently tied to
League #1 specifically, not "whichever league the caller currently has
active" — ESPN sync, weekly compute, bye-week sync, and player-database
ingestion all only ever affect League #1's ESPN-synced data (the only
ESPN-connected league that exists — see TODO.md's PHASE 9 entry, Phase
6, "per-league ESPN connection," not built yet). A League #2
commissioner has no reason to be able to trigger these, so the check is
require_commissioner_of(DEFAULT_LEAGUE_ID) — deliberately not the
"active league" resolver every other commissioner-gated router uses.

This used to run on a shared-secret X-Admin-Token header as a stopgap
before Phase 5's real auth existed; Phase 5 landed and was confirmed
working end-to-end back on Aug 19, 2026, so this router migrated to
match everything else rather than staying on the old stopgap
indefinitely.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.analytics import taxonomy
from app.analytics.rate_limit import is_rate_limited
from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of, require_site_admin
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.db import get_pool
from app.domain.bye_weeks import sync_bye_weeks
from app.domain.player_projections import sync_projected_points
from app.domain.weekly_stats import compute_and_store_week
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.sleeper.ingest import sync_players
from app.providers.sync import run_full_sync, run_live_sync
from app.queries import admin_analytics, admin_leagues, admin_overview, admin_users

router = APIRouter(prefix="/admin", tags=["admin"])


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.post("/sync")
async def trigger_sync(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    results = await run_full_sync(
        provider, espn_config.league_start_season, espn_config.active_season
    )
    return {"results": results}


@router.post("/sync/live")
async def trigger_live_sync(request: Request):
    """Manual trigger for the fast current-week-only sync (see
    app/providers/sync.py's run_live_sync) — same thing the scheduled
    live-sync job does, on demand. Ignores the game-window gate: if
    you're explicitly asking for it, run it."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    season = espn_config.active_season
    week = await provider.get_current_week(season)
    results = await run_live_sync(provider, season, week)
    return {"season": season, "week": week, "results": results}


@router.post("/weekly-compute")
async def trigger_weekly_compute(request: Request, week: int | None = None):
    """Manual trigger for this app's own Phase D/F scoring compute
    (app/domain/weekly_stats.py's compute_and_store_week) — same thing
    the scheduled weekly-compute job does during a live game window,
    on demand and ignoring that gate, for testing without waiting on a
    real game. Defaults to the active season's current week (same
    source as /admin/sync/live); pass ?week=N to recompute a specific
    week instead."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    season = espn_config.active_season
    if week is None:
        week = await provider.get_current_week(season)
    results = await compute_and_store_week(await get_pool(), season, week)
    return {"season": season, "week": week, "results": results}


@router.post("/sync/bye-weeks")
async def trigger_bye_week_sync(request: Request):
    """Manual trigger for app/domain/bye_weeks.py's sync_bye_weeks —
    18 real scoreboard fetches (one per regular-season week) to derive
    every team's one bye week, cached in team_bye_weeks. Real NFL bye
    weeks are set once at schedule release and don't change mid-season,
    so this is commissioner-triggered (run once after the schedule is
    out, or if it's ever missed), not a continuous scheduler like the
    other sync jobs above."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)

        season = ESPNConfig().active_season
        count = await sync_bye_weeks(conn, season)
    return {"season": season, "teams_synced": count}


@router.post("/players/sync")
async def trigger_player_sync(request: Request):
    """Manual trigger for the Sleeper player-database ingestion (see
    app/providers/sleeper/ingest.py) — run this by hand right after it
    ships rather than waiting for the daily scheduled job's first tick,
    since the draft player pool depends on this table being populated.
    Not really League #1-specific (the players table is global), but
    still commissioner-gated the same way as everything else here
    rather than being the one open endpoint in this router."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)

    count = await sync_players(await get_pool())
    return {"players_upserted": count}


@router.post("/players/sync-projections")
async def trigger_projected_points_sync(request: Request):
    """Manual trigger for the bulk ESPN projected-points sync (see
    app/domain/player_projections.py) — run this by hand right after it
    ships rather than waiting for the daily scheduled job's first tick,
    same reasoning as /players/sync above. Not League #1-specific
    either (players is a global table), commissioner-gated the same way
    as everything else in this router."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)
        results = await sync_projected_points(conn)
    return results


# ---- Admin dashboard / product intelligence (2026-09) — site-owner-only
# visibility into who's using The Weekend and how. Gated by
# require_site_admin (app/auth/league_context.py), NOT the sync
# endpoints' own require_commissioner_of(DEFAULT_LEAGUE_ID) above —
# is_site_admin is a strict superset (League #1 commissioner still
# qualifies) but also grantable independently via users.is_admin, so
# the real owner can hand someone dashboard access (PATCH
# /admin/users/{user_id}/admin below) without also handing them full
# League #1 commissioner power (which the sync endpoints above still
# require on their own — a deliberately bigger, separate grant). POST
# /track itself is open to any signed-in owner (it only ever writes an
# event tagged with THEIR OWN owner_id, server-derived from the session
# — never a client-supplied one — and never reads anything back). See
# ADMIN_SECURITY.md and ANALYTICS_EVENTS.md at the repo root for the
# full design.


def _clamp_days(days: int) -> int:
    return max(1, min(days, 365))


@router.get("/online")
async def get_online_owners(request: Request):
    """Username only, nothing else — who currently has the app open
    (any page, not just chat — see app/chat/manager.py's
    connected_owner_ids docstring for why this in-process registry is
    the real "who's using the app" signal)."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        owners = await admin_analytics.list_online_owners(conn)
    return {"owners": owners}


class TrackEventRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    event_name: str = Field(min_length=1, max_length=100)
    event_type: str
    route: str | None = None
    league_id: int | None = None
    metadata: dict = Field(default_factory=dict)
    device_type: str | None = None
    platform: str | None = None


@router.post("/track")
async def track_event(body: TrackEventRequest, request: Request):
    """Fire-and-forget event log — called from frontend/src/lib/
    analyticsEvents.ts's trackEvent() on every route change and every
    curated feature interaction. No admin gate: every signed-in owner
    can log their OWN event; only the aggregate reads below are
    admin-only. A no-op (not an error) for a session with no owner_id
    yet (signed up, hasn't joined a league) — an anonymous row would
    defeat the point of this table (see its own migration docstring).
    event_name/event_type/metadata are validated against
    app/analytics/taxonomy.py's fixed taxonomy — an unknown event name
    or a metadata key that taxonomy hasn't allowlisted for that event
    is rejected outright, not silently accepted (see taxonomy.py's own
    docstring for why)."""
    payload = _require_session(request)
    owner_id = payload.get("owner_id")
    if owner_id is None:
        return {"ok": True}
    if is_rate_limited(owner_id):
        raise HTTPException(status_code=429, detail="Too many events — try again shortly")

    error = taxonomy.validate_event(body.event_name, body.event_type, body.metadata, body.device_type, body.platform)
    if error:
        raise HTTPException(status_code=400, detail=error)

    route = body.route.strip()[: taxonomy.MAX_ROUTE_LENGTH] if body.route else None
    pool = await get_pool()
    async with pool.acquire() as conn:
        await admin_analytics.record_event(
            conn, owner_id, body.session_id, body.event_name, body.event_type, route,
            body.league_id, body.metadata, body.device_type, body.platform,
        )
    return {"ok": True}


@router.get("/overview")
async def get_overview(request: Request, days: int = 7):
    payload = _require_session(request)
    days = _clamp_days(days)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        kpis = await admin_overview.get_overview(conn, days)
        online = await admin_analytics.list_online_owners(conn)
    return {**kpis, "online_now": len(online)}


@router.get("/navigation")
async def get_navigation_heatmap(request: Request, days: int = 30):
    payload = _require_session(request)
    days = _clamp_days(days)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        heatmap = await admin_analytics.get_navigation_heatmap(conn, days)
    return heatmap


@router.get("/features")
async def get_feature_usage(request: Request, days: int = 30):
    payload = _require_session(request)
    days = _clamp_days(days)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        features = await admin_analytics.get_feature_usage(conn, days)
    return {"window_days": days, "features": features}


@router.get("/users")
async def list_users(request: Request, search: str | None = None, status: str = "all", limit: int = 50, offset: int = 0):
    payload = _require_session(request)
    if status not in admin_users.STATUS_FILTERS:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(admin_users.STATUS_FILTERS)}")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    search = search.strip()[:100] if search else None
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        result = await admin_users.list_users(conn, search, status, limit, offset)
    return result


@router.get("/users/{user_id}")
async def get_user_detail(user_id: int, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        user = await admin_users.get_user_detail(conn, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No user found")
    return user


class SetIsAdminRequest(BaseModel):
    is_admin: bool


@router.patch("/users/{user_id}/admin")
async def set_user_is_admin(user_id: int, body: SetIsAdminRequest, request: Request):
    """Grants or revokes admin-dashboard access independent of league
    role (see app/auth/league_context.py's is_site_admin) — the real
    owner's way to hand someone (e.g. a second commissioner) dashboard
    access without also handing them full League #1 commissioner
    power. Can't target your own row, same "the only way to lose it is
    someone ELSE doing it to you" safety as PATCH /leagues/{id}/members/
    {user_id} — a real risk here specifically, since revoking your own
    admin access through this endpoint could otherwise lock you out of
    the very screen you'd need to undo it from (unless you're also
    League #1's commissioner, which not every admin necessarily is)."""
    payload = _require_session(request)
    if user_id == payload["user_id"]:
        raise HTTPException(status_code=400, detail="Use another admin's account to change your own access")
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        user = await admin_users.set_is_admin(conn, user_id, body.is_admin)
    if user is None:
        raise HTTPException(status_code=404, detail="No user found")
    return user


@router.get("/leagues")
async def list_leagues(request: Request, days: int = 7):
    payload = _require_session(request)
    days = _clamp_days(days)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        leagues = await admin_leagues.list_leagues(conn, days)
    return {"window_days": days, "leagues": leagues}


@router.get("/leagues/{league_id}")
async def get_league_detail(league_id: int, request: Request, days: int = 7):
    payload = _require_session(request)
    days = _clamp_days(days)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        league = await admin_leagues.get_league_detail(conn, league_id, days)
    if league is None:
        raise HTTPException(status_code=404, detail="No league found")
    return league
