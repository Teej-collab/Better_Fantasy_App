"""
The public feeds the projection engine reads (app/domain/projections/).
No credentials anywhere:

  - Sleeper's weekly stats and projections (api.sleeper.com): every
    player's real stat line per week, with team and opponent, and
    Sleeper's own projected line.
  - ESPN's projections from its default league ("leaguedefaults"), the
    same numbers any ESPN league starts from, with the full projected
    stat line (ESPN stat ids; stat_lines.ESPN_TO_CATEGORY).
  - Vegas lines off ESPN's public scoreboard: spread and over/under,
    turned into each team's implied points.

Team codes come back in this app's convention (Washington is "WSH").
"""
import json

import httpx

_SLEEPER = "https://api.sleeper.com"
_ESPN_FANTASY = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3"
_ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
_POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")
_TEAM = {"WAS": "WSH"}

_ESPN_POSITION = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}
_ESPN_TEAM = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
    11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG",
    20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
    29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}


def team_code(abbr: str | None) -> str | None:
    return _TEAM.get(abbr, abbr) if abbr else abbr


async def sleeper_week(season: int, week: int, kind: str) -> list[dict]:
    """kind "stats" (what happened) or "projections". [{sleeper_player_id,
    position, team, opponent, stats}]"""
    params = [("season_type", "regular"), *(("position[]", p) for p in _POSITIONS)]
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{_SLEEPER}/{kind}/nfl/{season}/{week}", params=params)
        response.raise_for_status()
        rows = response.json() or []
    out = []
    for row in rows:
        player = row.get("player") or {}
        position = player.get("position")
        pid = row.get("player_id")
        if not pid or position not in _POSITIONS:
            continue
        out.append({
            "sleeper_player_id": team_code(pid) if position == "DEF" else pid,
            "position": position,
            "team": team_code(row.get("team")),
            "opponent": team_code(row.get("opponent")),
            "stats": row.get("stats") or {},
        })
    return out


async def espn_week_projections(season: int, week: int, limit: int = 1200) -> list[dict]:
    """[{espn_id, name, position, team, stats}] — ESPN's projected stat
    line for `week`, its most-rostered `limit` players."""
    period = f"11{season}{week}"
    fantasy_filter = {"players": {
        "limit": limit,
        "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
        "filterSlotIds": {"value": [0, 2, 4, 6, 16, 17]},
        "filterStatsForTopScoringPeriodIds": {"value": 1, "additionalValue": [period]},
    }}
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.get(
            _ESPN_FANTASY.format(season=season),
            params={"view": "kona_player_info", "scoringPeriodId": week},
            headers={"x-fantasy-filter": json.dumps(fantasy_filter)},
        )
        response.raise_for_status()
        players = response.json().get("players", [])
    out = []
    for entry in players:
        player = entry.get("player") or {}
        position = _ESPN_POSITION.get(player.get("defaultPositionId"))
        if position is None:
            continue
        stats = next(
            (s.get("stats") or {} for s in player.get("stats", [])
             if s.get("statSourceId") == 1 and s.get("scoringPeriodId") == week and s.get("statSplitTypeId") == 1),
            None,
        )
        if stats is None:
            continue
        out.append({
            "espn_id": player.get("id"),
            "name": player.get("fullName") or "",
            "position": position,
            "team": _ESPN_TEAM.get(player.get("proTeamId")),
            "stats": stats,
        })
    return out


async def vegas_lines(season: int, week: int) -> list[dict]:
    """[{team, opponent, is_home, spread, total, implied_points}] — spread
    from that team's side (negative = favored). Games without a posted
    line are left out."""
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(_ESPN_SCOREBOARD, params={"week": week, "seasontype": 2, "dates": season})
        response.raise_for_status()
        events = response.json().get("events", [])
    out = []
    for event in events:
        competition = (event.get("competitions") or [{}])[0]
        odds = (competition.get("odds") or [None])[0]
        teams = {c.get("homeAway"): team_code((c.get("team") or {}).get("abbreviation")) for c in competition.get("competitors", [])}
        if not odds or odds.get("overUnder") is None or odds.get("spread") is None or not teams.get("home") or not teams.get("away"):
            continue
        total = float(odds["overUnder"])
        home_spread = float(odds["spread"])  # ESPN's spread is the home side's
        for side, spread in (("home", home_spread), ("away", -home_spread)):
            out.append({
                "team": teams[side],
                "opponent": teams["away" if side == "home" else "home"],
                "is_home": side == "home",
                "spread": spread,
                "total": total,
                "implied_points": round(total / 2 - spread / 2, 2),
            })
    return out
