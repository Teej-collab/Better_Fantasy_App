"""NFL-wide (not league-specific) data — currently just the live
scoreboard for the logged-out homepage ticker (and the living home,
whose Weather Watch reads the kickoff wind added here)."""
from fastapi import APIRouter

from app.providers.game_wind import add_wind
from app.providers.nfl_scoreboard import get_nfl_scoreboard

router = APIRouter(prefix="/nfl", tags=["nfl"])


@router.get("/scoreboard")
async def scoreboard():
    return {"games": await add_wind(await get_nfl_scoreboard())}
