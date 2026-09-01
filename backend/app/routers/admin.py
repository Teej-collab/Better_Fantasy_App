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

from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.db import get_pool
from app.domain.bye_weeks import sync_bye_weeks
from app.domain.weekly_stats import compute_and_store_week
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.sleeper.ingest import sync_players
from app.providers.sync import run_full_sync, run_live_sync

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
