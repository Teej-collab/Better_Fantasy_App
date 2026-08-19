"""
Admin-only endpoints. Real auth (Phase 5) doesn't exist yet, so this uses
a shared-secret header as a deliberate stopgap — not meant to be the
long-term auth story. Revisit once Phase 5 lands.
"""
import os

from fastapi import APIRouter, Header, HTTPException

from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.sync import run_full_sync, run_live_sync

router = APIRouter(prefix="/admin", tags=["admin"])


def _check_admin_token(x_admin_token: str | None):
    expected = os.getenv("ADMIN_SYNC_TOKEN")
    if not expected:
        raise HTTPException(status_code=501, detail="ADMIN_SYNC_TOKEN not configured")
    if x_admin_token != expected:
        raise HTTPException(status_code=403, detail="Invalid admin token")


@router.post("/sync")
async def trigger_sync(x_admin_token: str | None = Header(default=None)):
    _check_admin_token(x_admin_token)

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    results = await run_full_sync(
        provider, espn_config.league_start_season, espn_config.active_season
    )
    return {"results": results}


@router.post("/sync/live")
async def trigger_live_sync(x_admin_token: str | None = Header(default=None)):
    """Manual trigger for the fast current-week-only sync (see
    app/providers/sync.py's run_live_sync) — same thing the scheduled
    live-sync job does, on demand. Ignores the game-window gate: if
    you're explicitly asking for it, run it."""
    _check_admin_token(x_admin_token)

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    season = espn_config.active_season
    week = await provider.get_current_week(season)
    results = await run_live_sync(provider, season, week)
    return {"season": season, "week": week, "results": results}
