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

get_projections below is unrelated to League.free_agents() (see its
own docstring for why that path was retired for projections too,
2026-09) — it feeds the same read-only display enrichment (the draft
pool's inline projected-points column plus per-week matchup
projections, app/domain/player_projections.py) via League.player_info/
player_map instead.
"""
import re

from espn_api.football import League

from app.providers.espn.config import ESPNConfig

# ESPN's player_map carries a trailing suffix for some active players
# that Sleeper's own full_name doesn't (empirically confirmed 2026-09:
# real starters "Anthony Richardson"/"Michael Penix"/"Brian Robinson"
# were silently missing projections because ESPN indexes them as
# "Anthony Richardson Sr."/"Michael Penix Jr."/"Brian Robinson Jr.").
_SUFFIX_RE = re.compile(r"\s+(Jr\.?|Sr\.?|II|III|IV)$", re.IGNORECASE)


def _strip_suffix(name: str) -> str:
    return _SUFFIX_RE.sub("", name).strip()


def _dst_key(name: str) -> str:
    """Sleeper stores a D/ST's full_name as the real NFL team's full
    name ("Houston Texans"); ESPN's player_map indexes the same unit as
    "<nickname> D/ST" ("Texans D/ST") under a negative playerId
    (empirically confirmed: -16001..-16034 cover all 32 teams, and
    player_info returns real projections for them same as any skill
    player). NFL nicknames are reliably the last word of the full team
    name for all 32 real teams (no multi-word nickname exists), so this
    is safe as a plain split rather than a hardcoded 32-team table."""
    return f"{name.rsplit(' ', 1)[-1]} D/ST"


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


def get_projections(
    known_espn_ids: list[int], unresolved_names: list[str],
    config: ESPNConfig | None = None, season: int | None = None,
) -> dict:
    """Bulk projected-points read via League.player_info(playerId=[...]),
    covering both players this app already has an espn_player_id
    crosswalk for AND ones that still need one resolved by name —
    against League.player_map, ESPN's own full player-name index
    (5000+ real NFL players, independent of roster status on any
    particular ESPN league, unlike free_agents() below).

    Replaces a former League.free_agents()-based read (2026-09, real
    incident): free_agents() only returns players NOT rostered on
    ESPN's OWN league, which — now that this league's real draft
    happens in this app instead — silently excluded every actual star
    player real owners had drafted here, since ESPN's own separate,
    now-disconnected league had already auto-rostered them elsewhere
    (Mahomes/McCaffrey/Bowers/Metcalf all came back projected_points=
    NULL despite a sync having just run, and could never resolve a
    name match either, for the same reason). player_info/player_map
    work regardless of a player's ESPN-side roster status, closing
    both gaps at once.

    Returns {"by_espn_id": {espn_id: {projected_points,
    projected_avg_points}}, "resolved_ids_by_name": {name: espn_id}} —
    the season total (same field the draft pool already showed) and
    ESPN's own per-game average, the best available stand-in for "this
    week's projection" before a real week-specific number exists
    (ESPN's own player data doesn't expose one pre-season —
    empirically confirmed).

    Empirically confirmed fast/safe as a single batched player_info
    call at ~650 ids (~1.2s); espn_api's own player_info does one HTTP
    request total regardless of list size, so this doesn't chunk.

    Falls back through two more lookups for a name that doesn't match
    player_map exactly: the D/ST nickname form (_dst_key) and the
    suffix-stripped form (_strip_suffix) — see each helper's own
    docstring for the real gaps they close (every D/ST unit, plus
    active players like Anthony Richardson/Michael Penix that ESPN
    carries a Jr./Sr. suffix for)."""
    config = config or ESPNConfig()
    league = _get_league(config, season)

    player_map = league.player_map
    stripped_map: dict[str, int] = {}
    for name, pid in player_map.items():
        if not isinstance(pid, int):
            continue
        stripped = _strip_suffix(name)
        if stripped != name:
            stripped_map.setdefault(stripped, pid)

    resolved_ids_by_name: dict[str, int] = {}
    for name in unresolved_names:
        espn_id = player_map.get(name)
        if not isinstance(espn_id, int):
            espn_id = player_map.get(_dst_key(name))
        if not isinstance(espn_id, int):
            espn_id = stripped_map.get(name)
        if isinstance(espn_id, int):
            resolved_ids_by_name[name] = espn_id

    all_ids = list(known_espn_ids) + list(resolved_ids_by_name.values())
    if not all_ids:
        return {"by_espn_id": {}, "resolved_ids_by_name": resolved_ids_by_name}

    result = league.player_info(playerId=all_ids)
    players = result if isinstance(result, list) else ([result] if result else [])
    # projected_total_points/projected_avg_points come back as raw
    # IEEE-754 doubles off ESPN's own JSON (e.g. 283.3899999999999...)
    # — left as-is here; app/domain/player_projections.py rounds on
    # the Postgres side (ROUND(...::numeric, 2)) rather than in Python,
    # since a Python float round() is still a float with the same
    # representation problem and wouldn't actually land a clean value
    # in storage.
    by_espn_id = {
        p.playerId: {"projected_points": p.projected_total_points, "projected_avg_points": p.projected_avg_points}
        for p in players
    }
    return {"by_espn_id": by_espn_id, "resolved_ids_by_name": resolved_ids_by_name}
