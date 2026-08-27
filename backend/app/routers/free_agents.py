"""
Free agent / waiver-wire browsing — see app/providers/espn/free_agents.py
for what this can and can't tell you per player. Unauthenticated, same
as /league and /standings: real ESPN data for this one private league,
read via the backend's own already-configured ESPN_S2/SWID, not
anything sensitive about a specific user.
"""
from fastapi import APIRouter, HTTPException

from app.config import _require
from app.db import get_pool
from app.providers.espn.free_agents import get_free_agents, get_waiver_settings

router = APIRouter(prefix="/free-agents", tags=["free-agents"])

_VALID_POSITIONS = {"QB", "RB", "WR", "TE", "D/ST", "K"}


async def _attach_sleeper_ids(players: list[dict]) -> None:
    """Free agents come back keyed by ESPN's own numeric player_id (this
    list is still ESPN-sourced — see free_agents.py's module docstring
    on why). The player-card feature (app/routers/players.py) is keyed
    by sleeper_player_id instead, so each entry gets a `sleeper_player_id`
    (nullable — not every free agent has a resolved crosswalk row yet)
    matched via players.espn_player_id, mutated in place."""
    espn_ids = [p["player_id"] for p in players]
    if not espn_ids:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT espn_player_id, sleeper_player_id FROM players WHERE espn_player_id = ANY($1::int[])",
            espn_ids,
        )
    sleeper_id_by_espn_id = {row["espn_player_id"]: row["sleeper_player_id"] for row in rows}
    for player in players:
        player["sleeper_player_id"] = sleeper_id_by_espn_id.get(player["player_id"])


@router.get("")
async def free_agents(position: str | None = None, size: int = 50):
    if position is not None and position.upper() not in _VALID_POSITIONS:
        raise HTTPException(status_code=400, detail=f"position must be one of {sorted(_VALID_POSITIONS)}")
    if not (1 <= size <= 200):
        raise HTTPException(status_code=400, detail="size must be between 1 and 200")

    active_season = int(_require("ACTIVE_SEASON"))
    players = get_free_agents(season=active_season, position=position.upper() if position else None, size=size)
    await _attach_sleeper_ids(players)
    return {"season": active_season, "players": players}


@router.get("/waiver-settings")
async def waiver_settings():
    active_season = int(_require("ACTIVE_SEASON"))
    return get_waiver_settings(season=active_season)
