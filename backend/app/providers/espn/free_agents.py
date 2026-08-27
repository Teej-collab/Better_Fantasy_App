"""
League waiver rules — read-only, real ESPN data (league.settings.faab)
scoped to this specific league. Same espn_api / league_get read path
the sync pipeline and ESPNLineupClient already use successfully in
production; no new credentials needed.

The actual free-agent player list used to live here too (a
League.free_agents() read, keyed by ESPN's own numeric player_id) but
was retired: its ESPN id didn't reliably cross-reference to a
sleeper_player_id, so the real add-to-roster write
(app/routers/me.py's /team/free-agents/add) could never be wired up
against it. The free-agent browse page (FreeAgentsList.tsx) now reads
the Sleeper-sourced `players` pool directly instead (GET
/me/team/free-agents) — see app/routers/me.py's module docstring. This
file keeps only the waiver-rule lookup, which was never player-specific
and has no crosswalk problem to begin with.
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


def get_waiver_settings(config: ESPNConfig | None = None, season: int | None = None) -> dict:
    config = config or ESPNConfig()
    league = _get_league(config, season)
    return {
        "uses_faab": bool(league.settings.faab),
        "acquisition_budget": league.settings.acquisition_budget,
    }
