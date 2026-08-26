"""NFL-wide (not league-specific) data — currently just the live
scoreboard for the logged-out homepage ticker."""
import httpx
from fastapi import APIRouter

from app.providers.nfl_scoreboard import get_nfl_scoreboard

router = APIRouter(prefix="/nfl", tags=["nfl"])


@router.get("/scoreboard")
async def scoreboard():
    return {"games": await get_nfl_scoreboard()}


# TEMPORARY — Phase D team D/ST verification spike, removed once done.
@router.get("/_debug_summary_header")
async def _debug_summary_header(event_id: str):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary",
            params={"event": event_id},
        )
        response.raise_for_status()
        data = response.json()

    header = data.get("header", {})
    result = {"header_keys": list(header.keys())}
    competitions = header.get("competitions", [])
    if competitions:
        comp = competitions[0]
        result["competition_keys"] = list(comp.keys())
        result["competitors"] = comp.get("competitors")
    boxscore_teams = data.get("boxscore", {}).get("teams", [])
    if boxscore_teams:
        result["boxscore_team0"] = {
            "team": boxscore_teams[0].get("team"),
            "homeAway": boxscore_teams[0].get("homeAway"),
            "totalYards_stat": next(
                (s for s in boxscore_teams[0].get("statistics", []) if s.get("name") == "totalYards"), None
            ),
        }
    return result
