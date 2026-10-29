"""
Wind at kickoff for outdoor NFL games, for the living home's Weather
Watch. ESPN's own event weather (nfl_scoreboard._weather) is only a
one-line description and a temperature, with no wind, and wind is the
weather that moves kickers and passing games most. Open-Meteo is free
and keyless: its geocoder turns the stadium's city (from ESPN's venue
address) into coordinates, then its forecast gives the hourly wind
there, read at the kickoff hour.

Best effort only: any failure leaves a game's weather as ESPN gave it,
and the scoreboard never waits on this for more than a few seconds.
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Open-Meteo forecasts 16 days out, but ESPN only forecasts the week
# ahead, and a wind forecast further out than that isn't worth showing.
MAX_DAYS_AHEAD = 7
_FORECAST_TTL_SECONDS = 30 * 60
_TIMEOUT_SECONDS = 4.0

# ESPN gives US states as abbreviations, the geocoder as full names;
# without this, "Arlington, TX" could come back as Arlington, Virginia.
US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

# A city's coordinates never change, so they're kept for the life of
# the process (None = the geocoder had no match; don't ask again).
_coords: dict[tuple, tuple[float, float] | None] = {}
_forecasts: dict[tuple[float, float], tuple[float, dict]] = {}
_lock = asyncio.Lock()


def clear_wind_cache() -> None:
    _coords.clear()
    _forecasts.clear()


async def _geocode(client: httpx.AsyncClient, location: dict) -> tuple[float, float] | None:
    city = location.get("city")
    if not city:
        return None
    key = (city, location.get("state"), location.get("country"))
    if key in _coords:
        return _coords[key]
    response = await client.get(GEOCODE_URL, params={"name": city, "count": 10, "language": "en", "format": "json"})
    response.raise_for_status()
    results = response.json().get("results") or []
    state = US_STATES.get(location.get("state") or "")
    if location.get("country") == "USA":
        results = [r for r in results if r.get("country_code") == "US" and (not state or r.get("admin1") == state)]
    match = results[0] if results else None
    _coords[key] = (round(match["latitude"], 2), round(match["longitude"], 2)) if match else None
    return _coords[key]


async def _hourly_wind(client: httpx.AsyncClient, coords: tuple[float, float]) -> dict:
    hit = _forecasts.get(coords)
    if hit and time.monotonic() - hit[0] < _FORECAST_TTL_SECONDS:
        return hit[1]
    response = await client.get(
        FORECAST_URL,
        params={
            "latitude": coords[0],
            "longitude": coords[1],
            "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
            "wind_speed_unit": "mph",
            "timezone": "UTC",
            "forecast_days": MAX_DAYS_AHEAD + 1,
        },
    )
    response.raise_for_status()
    hourly = response.json().get("hourly") or {}
    _forecasts[coords] = (time.monotonic(), hourly)
    return hourly


def wind_at(hourly: dict, kickoff: datetime) -> dict | None:
    """The forecast hour nearest kickoff, as the fields the scoreboard's
    weather gains. None when the forecast doesn't reach that hour."""
    hour = (kickoff + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
    stamp = hour.strftime("%Y-%m-%dT%H:%M")
    times = hourly.get("time") or []
    if stamp not in times:
        return None
    i = times.index(stamp)

    def value(name: str) -> int | None:
        series = hourly.get(name) or []
        return round(series[i]) if i < len(series) and series[i] is not None else None

    speed = value("wind_speed_10m")
    if speed is None:
        return None
    return {"wind_mph": speed, "wind_gust_mph": value("wind_gusts_10m"), "wind_dir": value("wind_direction_10m")}


def _kickoff(game: dict) -> datetime | None:
    raw = game.get("date")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


async def add_wind(games: list[dict]) -> list[dict]:
    """Adds wind_mph / wind_gust_mph / wind_dir (degrees, where it blows
    from) to the weather of every outdoor game kicking off in the next
    week. Changes `games` in place and returns it."""
    now = datetime.now(timezone.utc)
    wanted = []
    for game in games:
        kickoff = _kickoff(game)
        if game.get("state") != "pre" or game.get("indoor") or not game.get("location") or kickoff is None:
            continue
        if kickoff < now - timedelta(hours=1) or kickoff > now + timedelta(days=MAX_DAYS_AHEAD):
            continue
        wanted.append((game, kickoff))
    if not wanted:
        return games

    async def one(client: httpx.AsyncClient, game: dict, kickoff: datetime) -> None:
        coords = await _geocode(client, game["location"])
        if coords is None:
            return
        wind = wind_at(await _hourly_wind(client, coords), kickoff)
        if wind is None:
            return
        game["weather"] = {**(game.get("weather") or {"condition": None, "temperature": None}), **wind}

    try:
        # One refresh at a time, so a burst of page loads after the
        # cache expires asks Open-Meteo once, not once per request.
        async with _lock, httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            results = await asyncio.wait_for(
                asyncio.gather(*(one(client, g, k) for g, k in wanted), return_exceptions=True),
                timeout=_TIMEOUT_SECONDS * 2,
            )
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Couldn't get a wind forecast: %r", result)
    except Exception:
        logger.warning("Wind forecasts unavailable; serving ESPN's weather alone", exc_info=True)
    return games
