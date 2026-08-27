"""
NFL-wide live scoreboard, for the logged-out (and supplementary
logged-in) homepage ticker, and for real Game Day detection (see
is_nfl_game_live below, app/routers/game_day.py, app/scheduler.py).
Deliberately separate from app/providers/espn/ — this hits ESPN's
public, unauthenticated sports scoreboard API (site.api.espn.com), not
the private fantasy league API (lm-api-reads.fantasy.espn.com), and
needs no ESPN_S2/SWID credentials at all. Verified live against real
data before building this (2026 preseason Week 3 scores) — see TODO.md.

get_week_scoreboard (added for Phase D/F's automatic weekly compute
wiring) is the "which ESPN event ids belong to fantasy week N" answer
that domain/weekly_stats.py's compute_week_stats() needs — verified
live (2026-08-26) that this same endpoint accepts week/seasontype/dates
query params and returns exactly that week's real slate, with a
week.number field to cross-check against.
"""
import httpx

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"

# ESPN's seasontype values — 1 = preseason, 2 = regular season, 3 =
# postseason. This league's fantasy playoffs (see the owner's real
# league settings — Playoff Teams: 4, Weeks Per Playoff Matchup: 2) are
# just later regular-season NFL weeks, not real NFL postseason games,
# so REGULAR covers every fantasy week that matters, including fantasy
# playoff weeks.
SEASON_TYPE_PRESEASON = 1
SEASON_TYPE_REGULAR = 2


def is_nfl_game_live(games: list[dict]) -> bool:
    """True iff at least one real NFL game is in progress right now.
    Replaces app/game_windows.py's old day-of-week/hour heuristic (see
    TODO.md, Aug 19 2026: a game outside its fixed windows never
    triggered Game Day, and any evening in those windows with no real
    game still did) — this checks ESPN's own live status per game
    instead of guessing from the calendar."""
    return any(g.get("state") == "in" for g in games)


def _parse_scoreboard_events(data: dict) -> list[dict]:
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
                # Real ISO8601 UTC kickoff time — e.g. "2026-08-21T00:00Z".
                # Not surfaced to the frontend (the ticker only needs
                # status_detail's human string); used by
                # app/domain/chug_deadline.py to find the real Monday
                # Night Football kickoff for Jeffrey's Rule's deadline.
                "date": event.get("date"),
            }
        )
    return games


async def get_nfl_scoreboard() -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(SCOREBOARD_URL)
        response.raise_for_status()
        return _parse_scoreboard_events(response.json())


async def get_week_scoreboard(week: int, year: int, season_type: int = SEASON_TYPE_REGULAR) -> list[dict]:
    """Same normalized shape as get_nfl_scoreboard(), but for a
    specific week/season/season-type instead of whatever's happening
    right now — the source of event ids for
    app/domain/weekly_stats.py's compute_week_stats()."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            SCOREBOARD_URL, params={"week": week, "seasontype": season_type, "dates": year}
        )
        response.raise_for_status()
        return _parse_scoreboard_events(response.json())
