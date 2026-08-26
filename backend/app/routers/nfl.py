"""NFL-wide (not league-specific) data — currently just the live
scoreboard for the logged-out homepage ticker."""
import httpx
from fastapi import APIRouter

from app.providers.nfl_scoreboard import get_nfl_scoreboard

router = APIRouter(prefix="/nfl", tags=["nfl"])


@router.get("/scoreboard")
async def scoreboard():
    return {"games": await get_nfl_scoreboard()}


# TEMPORARY — verifying week-filtered scoreboard query params for
# automatic weekly compute wiring, removed once done.
@router.get("/_debug_week_scoreboard")
async def _debug_week_scoreboard(week: int, year: int = 2026, seasontype: int = 1):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
            params={"week": week, "seasontype": seasontype, "dates": year},
        )
        response.raise_for_status()
        data = response.json()

    return {
        "top_level_keys": list(data.keys()),
        "week_field": data.get("week"),
        "season_field": data.get("season"),
        "event_count": len(data.get("events", [])),
        "events": [
            {"id": e.get("id"), "name": e.get("name"), "date": e.get("date"),
             "week": e.get("week")}
            for e in data.get("events", [])
        ],
    }
