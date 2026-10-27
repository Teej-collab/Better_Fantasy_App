"""
Fantasy Football Calculator's public ADP API
(https://help.fantasyfootballcalculator.com/article/42-adp-rest-api):
free for personal and commercial use, credited with a link (the draft
room's footer). It refreshes once a day, so app/domain/adp.py calls it
once a day per format at most.

It only returns its most recent window of drafts and ignores any date
asked for — a season's preseason ADP has to be saved while it's live.
"""
import httpx

BASE_URL = "https://fantasyfootballcalculator.com/api/v1/adp"
FORMATS = ("standard", "half-ppr", "ppr", "2qb", "dynasty")
TEAM_SIZES = (8, 10, 12, 14)


async def fetch_adp(fmt: str, teams: int, year: int, timeout: float = 20) -> dict:
    """{"meta": {...}, "players": [...]} straight from the API.
    Raises httpx.HTTPError on a failed request."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(f"{BASE_URL}/{fmt}", params={"teams": teams, "year": year, "position": "all"})
        response.raise_for_status()
        data = response.json()
    if data.get("status") != "Success":
        raise httpx.HTTPError(f"Fantasy Football Calculator ADP returned status {data.get('status')!r}")
    return data
