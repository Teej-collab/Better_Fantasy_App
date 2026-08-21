"""
Free agent / waiver-wire browsing — see app/providers/espn/free_agents.py
for what this can and can't tell you per player. Unauthenticated, same
as /league and /standings: real ESPN data for this one private league,
read via the backend's own already-configured ESPN_S2/SWID, not
anything sensitive about a specific user.
"""
from fastapi import APIRouter, HTTPException

from app.config import _require
from app.providers.espn.free_agents import get_free_agents, get_waiver_settings

router = APIRouter(prefix="/free-agents", tags=["free-agents"])

_VALID_POSITIONS = {"QB", "RB", "WR", "TE", "D/ST", "K"}


@router.get("")
async def free_agents(position: str | None = None, size: int = 50):
    if position is not None and position.upper() not in _VALID_POSITIONS:
        raise HTTPException(status_code=400, detail=f"position must be one of {sorted(_VALID_POSITIONS)}")
    if not (1 <= size <= 200):
        raise HTTPException(status_code=400, detail="size must be between 1 and 200")

    active_season = int(_require("ACTIVE_SEASON"))
    players = get_free_agents(season=active_season, position=position.upper() if position else None, size=size)
    return {"season": active_season, "players": players}


@router.get("/waiver-settings")
async def waiver_settings():
    active_season = int(_require("ACTIVE_SEASON"))
    return get_waiver_settings(season=active_season)
