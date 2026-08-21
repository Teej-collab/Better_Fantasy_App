"""
Free agent / waiver-wire browsing — read-only, real ESPN data scoped to
this specific league (League.free_agents() already excludes anyone
actually rostered on one of this league's 12 real teams — it's not a
generic NFL-wide player pool). Same espn_api / league_get read path the
sync pipeline and ESPNLineupClient already use successfully in
production; no new credentials needed.

Deliberately doesn't claim to label any individual player "waivers" vs.
"free agent" — ESPN's own filter (filterStatus: ["FREEAGENT", "WAIVERS"])
returns both together, and the parsed player data doesn't reliably carry
which bucket a given player is in right now (checked against a real
live pull: acquisitionType comes back empty for every unrostered
player). What IS real and shown here instead: this league's actual
waiver rule, confirmed via league.settings.faab — Standard waiver
priority, not FAAB blind-bidding — so the page is honest about what it
can and can't tell you per player.

Read-only: no add/claim action exists yet, and actually submitting a
waiver claim or free-agent add to ESPN has never been investigated at
all (no captured request, unlike the lineup-write work — see
ESPN_LINEUP_WRITE.md). That's a deliberate scoping decision, not an
oversight — see TODO.md.
"""
from espn_api.football import League

from app.providers.espn.config import ESPNConfig


def _get_league(config: ESPNConfig, season: int | None) -> League:
    return League(
        league_id=config.league_id,
        year=season or config.active_season,
        espn_s2=config.espn_s2,
        swid=config.swid,
    )


def _to_free_agent_dict(player) -> dict:
    return {
        "player_id": player.playerId,
        "name": player.name,
        "position": player.position,
        "pro_team": player.proTeam,
        "injury_status": player.injuryStatus,
        "percent_owned": player.percent_owned,
        "percent_started": player.percent_started,
        "projected_points": player.projected_points,
        "points": player.points,
    }


def get_free_agents(
    config: ESPNConfig | None = None,
    season: int | None = None,
    position: str | None = None,
    size: int = 50,
) -> list[dict]:
    config = config or ESPNConfig()
    league = _get_league(config, season)
    players = league.free_agents(size=size, position=position)
    return [_to_free_agent_dict(p) for p in players]


def get_waiver_settings(config: ESPNConfig | None = None, season: int | None = None) -> dict:
    config = config or ESPNConfig()
    league = _get_league(config, season)
    return {
        "uses_faab": bool(league.settings.faab),
        "acquisition_budget": league.settings.acquisition_budget,
    }
