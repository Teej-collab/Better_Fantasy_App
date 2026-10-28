"""
Looking a league up on ESPN or Sleeper before bringing it in
(2026-10-24): the new-commissioner flow's "Found your league" step —
its name, season, current week and teams — without saving anything.
Connecting it for real is still POST /league/espn-connection or
/league/sleeper-connection once the league exists here.
"""
import re

from espn_api.requests.espn_requests import ESPNAccessDenied

from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.sleeper import league as sleeper

PRIVATE_LEAGUE_MESSAGE = (
    "ESPN won't share that league yet: it is private to outside apps. On fantasy.espn.com (your phone's browser "
    "works), open League Manager → Settings → Basic Settings and turn on “Make League Viewable to Public” (your "
    "league stays private and your rules don't change), then try again. Or add your ESPN sign-in values below."
)


class ImportLookupError(Exception):
    """Something the commissioner can fix, said in plain words."""


def parse_espn_league_id(text: str) -> int | None:
    """An ESPN league link (…?leagueId=12345…) or the bare number."""
    text = (text or "").strip()
    match = re.search(r"leagueId=(\d+)", text) or re.fullmatch(r"(\d{3,12})", text)
    return int(match.group(1)) if match else None


async def preview(platform: str, text: str, season: int, espn_s2: str = "", espn_swid: str = "") -> dict:
    if platform == "espn":
        return await _preview_espn(text, season, espn_s2, espn_swid)
    if platform == "sleeper":
        return await _preview_sleeper(text, season)
    raise ImportLookupError("Only ESPN and Sleeper leagues can be brought in so far.")


async def _preview_espn(text: str, season: int, s2: str, swid: str) -> dict:
    league_id = parse_espn_league_id(text)
    if league_id is None:
        raise ImportLookupError("Paste your league's link from ESPN (it has leagueId= in it), or just the number.")
    provider = ESPNProvider(ESPNConfig(league_id=league_id, espn_s2=s2 or "", swid=swid or "", active_season=season))
    try:
        league = provider._league(season)
    except ESPNAccessDenied as e:
        if s2 and swid:
            raise ImportLookupError("ESPN didn't accept those sign-in values. Copy espn_s2 and SWID again and retry.") from e
        raise ImportLookupError(PRIVATE_LEAGUE_MESSAGE) from e
    except Exception as e:
        raise ImportLookupError("Couldn't find that ESPN league. Check the link and try again.") from e

    teams = []
    for team in league.teams:
        owner = (team.owners or [{}])[0]
        teams.append({
            "team_name": team.team_name,
            "owner_name": f"{owner.get('firstName', '')} {owner.get('lastName', '')}".strip() or None,
        })
    return {
        "platform": "espn",
        "external_id": str(league_id),
        "name": getattr(league.settings, "name", None) or f"ESPN league {league_id}",
        "season": season,
        "current_week": league.current_week,
        "team_count": len(teams),
        "teams": teams,
    }


async def _preview_sleeper(text: str, season: int) -> dict:
    league_id = sleeper.parse_league_id(text)
    if league_id is None:
        raise ImportLookupError("Paste your league's link from Sleeper (sleeper.com/leagues/…) or its league ID.")
    try:
        league = await sleeper.fetch_league(league_id)
    except sleeper.SleeperLeagueNotFound as e:
        raise ImportLookupError("Couldn't find that league on Sleeper. Check the link.") from e
    if str(league.get("season")) != str(season):
        raise ImportLookupError(f"That's Sleeper's {league.get('season')} league. Use your {season} league's link.")
    users = {u["user_id"]: u for u in (await sleeper._get(f"/league/{league_id}/users") or [])}
    rosters = await sleeper._get(f"/league/{league_id}/rosters") or []
    teams = []
    for roster in sorted(rosters, key=lambda r: r["roster_id"]):
        user = users.get(roster.get("owner_id"))
        teams.append({
            "team_name": ((user or {}).get("metadata") or {}).get("team_name")
            or (f"Team {user['display_name']}" if user else f"Team {roster['roster_id']}"),
            "owner_name": (user or {}).get("display_name"),
        })
    state = await sleeper._get("/state/nfl") or {}
    return {
        "platform": "sleeper",
        "external_id": league_id,
        "name": league.get("name") or "Sleeper league",
        "season": season,
        "current_week": int(state.get("week") or 1),
        "team_count": len(teams),
        "teams": teams,
    }


async def existing_league(conn, platform: str, external_id: str | int) -> dict | None:
    """An ESPN or Sleeper league that's already on The Weekend (2026-10-28):
    one copy per outside league, so a second person bringing it in joins
    that one instead of splitting the league in two. League #1 is
    connected through the server's own ESPN settings, not a row."""
    import os

    from app.config import DEFAULT_LEAGUE_ID

    league_id = None
    if platform == "espn":
        try:
            espn_id = int(external_id)
        except (TypeError, ValueError):
            return None
        league_id = await conn.fetchval("SELECT league_id FROM league_espn_connections WHERE espn_league_id = $1", espn_id)
        if league_id is None and os.getenv("ESPN_LEAGUE_ID", "").strip() == str(espn_id):
            league_id = DEFAULT_LEAGUE_ID
    elif platform == "sleeper":
        league_id = await conn.fetchval(
            "SELECT league_id FROM league_sleeper_connections WHERE sleeper_league_id = $1", str(external_id)
        )
    if league_id is None:
        return None
    row = await conn.fetchrow(
        """
        SELECT l.id, l.name,
               (SELECT COALESCE(u.display_name, 'the commissioner') FROM league_members lm JOIN users u ON u.id = lm.user_id
                WHERE lm.league_id = l.id AND lm.role = 'commissioner' ORDER BY lm.user_id LIMIT 1) AS commissioner
        FROM leagues l WHERE l.id = $1
        """,
        league_id,
    )
    return {"league_id": row["id"], "name": row["name"], "commissioner": row["commissioner"]} if row else None
