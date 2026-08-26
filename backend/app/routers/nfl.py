"""NFL-wide (not league-specific) data — currently just the live
scoreboard for the logged-out homepage ticker."""
import httpx
from fastapi import APIRouter

from app.providers.nfl_scoreboard import get_nfl_scoreboard

router = APIRouter(prefix="/nfl", tags=["nfl"])


@router.get("/scoreboard")
async def scoreboard():
    return {"games": await get_nfl_scoreboard()}


# TEMPORARY — Phase D verification spike (see project plan / TODO.md):
# checking whether ESPN's public summary endpoint exposes full
# per-player boxscore stat lines. Public data only, no auth needed,
# removed once the spike is done.
@router.get("/_debug_summary_shape")
async def _debug_summary_shape(event_id: str):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary",
            params={"event": event_id},
        )
        response.raise_for_status()
        data = response.json()

    boxscore = data.get("boxscore", {})
    players_section = boxscore.get("players", [])
    result = {"top_level_keys": list(data.keys()), "boxscore_keys": list(boxscore.keys())}
    if players_section:
        team_entry = players_section[0]
        result["players_team_entry_keys"] = list(team_entry.keys())
        stat_categories = team_entry.get("statistics", [])
        result["stat_category_names"] = [c.get("name") for c in stat_categories]
        if stat_categories:
            first_cat = stat_categories[0]
            result["first_category_keys"] = list(first_cat.keys())
            result["first_category_labels"] = first_cat.get("labels")
            athletes = first_cat.get("athletes", [])
            if athletes:
                result["first_athlete_sample"] = athletes[0]
    return result
