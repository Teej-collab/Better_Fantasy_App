"""
NFL-wide live scoreboard, for the logged-out (and supplementary
logged-in) homepage ticker, and for real Game Day detection (see
is_nfl_game_live below, app/routers/game_day.py, app/scheduler.py).
Deliberately separate from app/providers/espn/ — this hits ESPN's
public, unauthenticated sports scoreboard API (site.api.espn.com), not
the private fantasy league API (lm-api-reads.fantasy.espn.com), and
needs no ESPN_S2/SWID credentials at all. Verified live against real
data before building this (2026 preseason Week 3 scores) — see TODO.md.
"""
import httpx

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def is_nfl_game_live(games: list[dict]) -> bool:
    """True iff at least one real NFL game is in progress right now.
    Replaces app/game_windows.py's old day-of-week/hour heuristic (see
    TODO.md, Aug 19 2026: a game outside its fixed windows never
    triggered Game Day, and any evening in those windows with no real
    game still did) — this checks ESPN's own live status per game
    instead of guessing from the calendar."""
    return any(g.get("state") == "in" for g in games)


async def get_nfl_scoreboard() -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(SCOREBOARD_URL)
        response.raise_for_status()
        data = response.json()

    games = []
    for event in data.get("events", []):
        competitions = event.get("competitions") or []
        if not competitions:
            continue
        competition = competitions[0]
        competitors = competition.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue

        status_type = competition.get("status", {}).get("type", {})
        games.append(
            {
                "id": event.get("id"),
                "name": event.get("name"),
                "home_team": home.get("team", {}).get("abbreviation"),
                "home_score": home.get("score"),
                "away_team": away.get("team", {}).get("abbreviation"),
                "away_score": away.get("score"),
                "state": status_type.get("state"),  # "pre" | "in" | "post"
                "status_detail": status_type.get("shortDetail"),
                "completed": status_type.get("completed", False),
            }
        )
    return games
