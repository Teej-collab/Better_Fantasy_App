"""
League waiver rules — unauthenticated, same as /league and /standings:
real ESPN data for this one private league, read via the backend's own
already-configured ESPN_S2/SWID, not anything sensitive about a
specific user.

The actual free-agent player list used to live here too — retired, see
app/providers/espn/free_agents.py's module docstring for why. The real
browse-and-add flow is now GET/POST /me/team/free-agents* (session-aware,
Sleeper-sourced, backed by current_rosters).
"""
from fastapi import APIRouter

from app.config import _require
from app.providers.espn.free_agents import get_waiver_settings

router = APIRouter(prefix="/free-agents", tags=["free-agents"])


@router.get("/waiver-settings")
async def waiver_settings():
    active_season = int(_require("ACTIVE_SEASON"))
    return get_waiver_settings(season=active_season)
