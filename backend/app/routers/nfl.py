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
        stat_categories = team_entry.get("statistics", [])
        result["all_categories"] = {
            c.get("name"): {"keys": c.get("keys"), "labels": c.get("labels")} for c in stat_categories
        }
        rec_cat = next((c for c in stat_categories if c.get("name") == "receiving"), None)
        if rec_cat and rec_cat.get("athletes"):
            result["receiving_athlete_sample"] = rec_cat["athletes"][0]
        def_cat = next((c for c in stat_categories if c.get("name") == "defensive"), None)
        if def_cat and def_cat.get("athletes"):
            result["defensive_athlete_sample"] = def_cat["athletes"][0]

    teams_section = boxscore.get("teams", [])
    if teams_section:
        team0 = teams_section[0]
        result["team_stats_keys"] = list(team0.keys())
        stats = team0.get("statistics", [])
        result["team_stat_names"] = [s.get("name") for s in stats]
    return result
