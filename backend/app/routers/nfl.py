"""NFL-wide (not league-specific) data — currently just the live
scoreboard for the logged-out homepage ticker."""
from fastapi import APIRouter

from app.providers.nfl_scoreboard import get_nfl_scoreboard

router = APIRouter(prefix="/nfl", tags=["nfl"])


@router.get("/scoreboard")
async def scoreboard():
    return {"games": await get_nfl_scoreboard()}
