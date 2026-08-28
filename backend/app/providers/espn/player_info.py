"""
Real ESPN season/weekly point projections, ownership %, and bye-week/
next-opponent data for a single player — enrichment for the player-card
feature (app/domain/player_card.py). Read-only, same espn_api / League
read path the sync pipeline and free_agents.py already use successfully
in production — no new credentials, and no write risk (this pivot only
ever removed ESPN from the WRITE path for draft/rosters/lineups, see
the project plan; a plain read like this was never the problem).

espn_api itself is a synchronous requests-based library, same as
everywhere else this app already wraps it (adapter.py, lineup_client.py)
— callers should expect a real network round trip, not treat this as
free, and should be prepared for it to raise on a bad/unmapped id.
"""
import time

from espn_api.football import League

from app.providers.espn.config import ESPNConfig

# This league's real NFL regular season length (see
# app/providers/nfl_scoreboard.py's SEASON_TYPE_REGULAR docstring) —
# the range bye_week is derived from below.
REGULAR_SEASON_WEEKS = 18

# Building a League(...) fetches this league's teams/draft PLUS ESPN's
# entire NFL player universe (League._fetch_players(), used below for
# the name-based id fallback) — a real multi-second network round trip,
# not something to redo on every single player-card click in a browsing
# session. A short in-process cache (this app is a single small
# instance, no shared-cache infra needed) keeps repeated clicks snappy
# without serving stale ownership/projection data for long — 2 minutes
# is generous relative to how often those numbers actually move.
_LEAGUE_CACHE_TTL_SECONDS = 120
_league_cache: dict[tuple[int, int], tuple[League, float]] = {}


def _get_league(config: ESPNConfig, season: int | None) -> League:
    year = season or config.active_season
    cache_key = (config.league_id, year)
    cached = _league_cache.get(cache_key)
    if cached is not None:
        league, fetched_at = cached
        if time.monotonic() - fetched_at < _LEAGUE_CACHE_TTL_SECONDS:
            return league

    league = League(league_id=config.league_id, year=year, espn_s2=config.espn_s2, swid=config.swid)
    _league_cache[cache_key] = (league, time.monotonic())
    return league


def get_player_info(
    espn_player_id: int | None,
    full_name: str | None = None,
    config: ESPNConfig | None = None,
    season: int | None = None,
) -> dict | None:
    """Returns None if ESPN has no record of this player at all.

    espn_player_id may be None: Sleeper's own espn_id crosswalk is only
    populated for a minority of players (~22% of this league's
    draftable pool, confirmed against real production data) — when it
    is, full_name is used as a fallback against league.player_map, a
    name->id map espn_api already builds for ESPN's ENTIRE NFL player
    universe on every League fetch (League._fetch_players(), not scoped
    to this one league's rostered players), for free, as a side effect
    of building the League object this function needs anyway. Exact
    string match only — no fuzzy matching — so a real name formatting
    mismatch (suffixes, accents) can still miss; two real NFL players
    who happen to share a full name (confirmed in this league's own
    data: two different "Josh Allen"s) resolve to whichever espn_api's
    own dedup picked first, a rare, accepted mis-match risk rather than
    a reason to hold the whole feature back.

    The returned dict's "espn_player_id" is the id actually used (either
    the one passed in, or the one resolved via full_name) — callers
    that resolved via name should persist it back onto players.
    espn_player_id so future lookups (and Phase D's weekly-stats
    crosswalk) skip the name-matching step entirely.

    bye_week is derived, not a field espn_api exposes directly: a
    player's `.schedule` dict is keyed by week number (as a STRING, not
    an int — confirmed against a real live call: {"1": {...}, "2":
    {...}, ..., "18": {...}} with the bye week's key simply absent) for
    every week their real NFL team plays, sourced from ESPN's own
    full-season pro schedule — so the one week from
    1..REGULAR_SEASON_WEEKS missing from that dict is the bye."""
    config = config or ESPNConfig()
    league = _get_league(config, season)

    resolved_id = espn_player_id
    if resolved_id is None and full_name:
        resolved_id = league.player_map.get(full_name)
    if resolved_id is None:
        return None

    player = league.player_info(playerId=resolved_id)
    if player is None:
        return None
    if isinstance(player, list):
        player = player[0]

    schedule_by_week = {int(week): game for week, game in player.schedule.items()}
    bye_week = next(
        (week for week in range(1, REGULAR_SEASON_WEEKS + 1) if week not in schedule_by_week),
        None,
    )
    # league.current_week is 0 during the preseason (confirmed against a
    # real live call, Aug 2026) — there's no "current" regular-season
    # week yet, so fall back to week 1 as the upcoming game to display.
    current_week = league.current_week or 1
    next_game = schedule_by_week.get(current_week)

    return {
        "espn_player_id": resolved_id,
        "season_projected_points": player.projected_total_points,
        "season_avg_projected_points": player.projected_avg_points,
        "percent_owned": player.percent_owned,
        "percent_started": player.percent_started,
        "bye_week": bye_week,
        "next_opponent": next_game["team"] if next_game else None,
        "current_week": current_week,
    }


def get_bulk_ownership(
    espn_player_ids: list[int], config: ESPNConfig | None = None, season: int | None = None
) -> dict[int, dict]:
    """Real ownership%/start% for a whole roster in ONE HTTP call —
    espn_api's League.player_info() already accepts a list of ids (see
    espn_api/football/league.py's player_info, which wraps a single id
    into a list internally anyway), it's just never been called that
    way in this codebase before (get_player_info above only ever passes
    one). Returns {espn_player_id: {percent_owned, percent_started}} —
    only for ids ESPN actually has a record of; a caller-side crosswalk
    gap (no espn_player_id at all) is filtered out before this is ever
    called, not handled here.

    percent_owned/percent_started come back as -1 (espn_api's own
    default) rather than None when ESPN has no ownership data for a
    given id — normalized to None here so "no data" reads the same way
    it does everywhere else in this app."""
    if not espn_player_ids:
        return {}
    config = config or ESPNConfig()
    league = _get_league(config, season)

    players = league.player_info(playerId=espn_player_ids)
    if players is None:
        return {}
    if not isinstance(players, list):
        players = [players]

    result = {}
    for player in players:
        result[player.playerId] = {
            "percent_owned": player.percent_owned if player.percent_owned != -1 else None,
            "percent_started": player.percent_started if player.percent_started != -1 else None,
        }
    return result
