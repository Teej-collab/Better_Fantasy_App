"""
League waiver rules — read-only, real ESPN data (league.settings.faab)
scoped to this specific league. Same espn_api / league_get read path
the sync pipeline and ESPNLineupClient already use successfully in
production; no new credentials needed.

The actual free-agent player list used to live here too (a
League.free_agents() read, keyed by ESPN's own numeric player_id) but
was retired for the roster-WRITE use case: its ESPN id didn't reliably
cross-reference to a sleeper_player_id, so the real add-to-roster write
(app/routers/me.py's /team/free-agents/add) could never be wired up
against it. The free-agent browse page (FreeAgentsList.tsx) now reads
the Sleeper-sourced `players` pool directly instead (GET
/me/team/free-agents) — see app/routers/me.py's module docstring.

get_all_projected_points below brings League.free_agents() back, but
only for a read-only display enrichment (the draft pool's inline
projected-points column, app/domain/player_projections.py) — the same
crosswalk gap that blocked a write only means some rows show no
projection there, not a blocked feature.
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


def get_all_projected_points(config: ESPNConfig | None = None, season: int | None = None) -> list[dict]:
    """Bulk projected-season-points read via League.free_agents() — the
    same call this file's own docstring says was retired for the
    roster-WRITE use case over the id-crosswalk gap. That gap only
    means "some rows get no projection" for a read-only display
    enrichment like this one, not a broken feature — see
    app/domain/player_projections.py, which accepts exactly that.

    Empirically confirmed (2026-09, live against this league's real
    ESPN connection) that during the preseason, ESPN's own free-agent/
    waiver view is essentially every real fantasy-relevant NFL player
    (840 results with size=2000) — nothing's been drafted on ESPN's own
    side yet this season, and this app never writes real draft picks
    back to ESPN, so that holds for the whole season. size=2000 leaves
    real headroom above that.

    posRank/draft_rank both come back as 0 for every player until ESPN
    itself has computed real position ranks for the season (also
    empirically confirmed) — not read here at all. This app already has
    a real ADP-equivalent, players.search_rank (Sleeper's own overall-
    rank proxy, already shown in the draft pool — see
    app/domain/draft_autopick.py's own docstring), and doesn't need a
    second, currently-nonfunctional one from ESPN."""
    config = config or ESPNConfig()
    league = _get_league(config, season)
    free_agents = league.free_agents(size=2000)
    # projected_total_points comes back as a raw IEEE-754 double off
    # ESPN's own JSON (e.g. 283.3899999999999...) — left as-is here;
    # app/domain/player_projections.py rounds it on the Postgres side
    # (ROUND(...::numeric, 2)) rather than in Python, since a Python
    # float round() is still a float with the same representation
    # problem and wouldn't actually land a clean value in storage.
    return [{"espn_player_id": p.playerId, "name": p.name, "projected_points": p.projected_total_points} for p in free_agents]
