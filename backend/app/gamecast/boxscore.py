"""
Gamecast's full box score (2026-10), like ESPN's: every player's line in
each category (passing, rushing, receiving, fumbles, defense,
interceptions, returns, kicking, punting) for both teams, with team
totals. Read from the same public ESPN game summary the scoring engine
uses (app/providers/nfl_stats/espn_public.py) — Gamecast's game ids are
ESPN event ids.

ESPN's box score has no positions, so each athlete is crosswalked to our
players table: that gives the position ("Prescott QB") and our player id,
which the app matches against the viewer's fantasy-impact lists to mark
their players and their opponent's.
"""
import time

from app.providers.nfl_stats.espn_public import _fetch_summary

# Live box scores move every play; a final one never changes.
_LIVE_TTL_SECONDS = 15
_FINAL_TTL_SECONDS = 30 * 60
_CACHE: dict[str, tuple[float, dict]] = {}

# The order ESPN lists them in, with the headings it uses.
CATEGORY_TITLES = {
    "passing": "Passing",
    "rushing": "Rushing",
    "receiving": "Receiving",
    "fumbles": "Fumbles",
    "defensive": "Defense",
    "interceptions": "Interceptions",
    "kickReturns": "Kick Returns",
    "puntReturns": "Punt Returns",
    "kicking": "Kicking",
    "punting": "Punting",
}


def parse_box_score(data: dict, crosswalk: dict[int, tuple[str, str]]) -> dict:
    """{"final": bool, "teams": [{abbr, name, logo, categories: [{key, title,
    labels, athletes: [{espn_id, player_id, name, short_name, position,
    stats}], totals}]}]} — away team first, like the scoreboard."""
    teams = []
    for entry in data.get("boxscore", {}).get("players", []):
        team = entry.get("team", {})
        categories = []
        for category in entry.get("statistics", []):
            key = category.get("name")
            if key not in CATEGORY_TITLES:
                continue
            athletes = []
            for row in category.get("athletes", []):
                athlete = row.get("athlete", {})
                espn_id = int(athlete["id"]) if athlete.get("id") else None
                player_id, position = crosswalk.get(espn_id, (None, None)) if espn_id else (None, None)
                athletes.append(
                    {
                        "espn_id": espn_id,
                        "player_id": player_id,
                        "name": athlete.get("displayName"),
                        "short_name": athlete.get("lastName") or athlete.get("displayName"),
                        "position": position,
                        "stats": row.get("stats", []),
                    }
                )
            if not athletes:
                continue
            categories.append(
                {
                    "key": key,
                    "title": CATEGORY_TITLES[key],
                    "labels": category.get("labels", []),
                    "athletes": athletes,
                    "totals": category.get("totals", []),
                }
            )
        categories.sort(key=lambda c: list(CATEGORY_TITLES).index(c["key"]))
        teams.append(
            {
                "abbr": team.get("abbreviation"),
                "name": team.get("shortDisplayName") or team.get("displayName"),
                "logo": team.get("logo"),
                "home_away": entry.get("homeAway") or _home_away(data, team.get("id")),
                "categories": categories,
            }
        )
    teams.sort(key=lambda t: 0 if t["home_away"] == "away" else 1)
    status = (data.get("header", {}).get("competitions") or [{}])[0].get("status", {}).get("type", {})
    return {"final": bool(status.get("completed")), "teams": teams}


def _home_away(data: dict, team_id) -> str | None:
    for competitor in (data.get("header", {}).get("competitions") or [{}])[0].get("competitors", []):
        if str(competitor.get("id") or competitor.get("team", {}).get("id")) == str(team_id):
            return competitor.get("homeAway")
    return None


async def get_box_score(conn, game_id: str) -> dict:
    cached = _CACHE.get(game_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    data = await _fetch_summary(game_id)
    espn_ids = [
        int(row["athlete"]["id"])
        for entry in data.get("boxscore", {}).get("players", [])
        for category in entry.get("statistics", [])
        for row in category.get("athletes", [])
        if row.get("athlete", {}).get("id")
    ]
    crosswalk: dict[int, tuple[str, str]] = {}
    if espn_ids:
        for r in await conn.fetch(
            "SELECT espn_player_id, sleeper_player_id, position FROM players WHERE espn_player_id = ANY($1::int[])",
            list(set(espn_ids)),
        ):
            crosswalk[r["espn_player_id"]] = (r["sleeper_player_id"], r["position"])
    result = parse_box_score(data, crosswalk)
    ttl = _FINAL_TTL_SECONDS if result["final"] else _LIVE_TTL_SECONDS
    _CACHE[game_id] = (time.monotonic() + ttl, result)
    return result
