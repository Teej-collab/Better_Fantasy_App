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
from espn_api.football import League

from app.providers.espn.config import ESPNConfig

# This league's real NFL regular season length (see
# app/providers/nfl_scoreboard.py's SEASON_TYPE_REGULAR docstring) —
# the range bye_week is derived from below.
REGULAR_SEASON_WEEKS = 18


def _get_league(config: ESPNConfig, season: int | None) -> League:
    return League(
        league_id=config.league_id,
        year=season or config.active_season,
        espn_s2=config.espn_s2,
        swid=config.swid,
    )


def get_player_info(espn_player_id: int, config: ESPNConfig | None = None, season: int | None = None) -> dict | None:
    """Returns None if ESPN has no record of this player id — rare, but
    Sleeper's espn_id crosswalk isn't guaranteed accurate (see
    app/providers/sleeper/ingest.py's crosswalk canary log).

    bye_week is derived, not a field espn_api exposes directly: a
    player's `.schedule` dict is keyed by week number (as a STRING, not
    an int — confirmed against a real live call: {"1": {...}, "2":
    {...}, ..., "18": {...}} with the bye week's key simply absent) for
    every week their real NFL team plays, sourced from ESPN's own
    full-season pro schedule — so the one week from
    1..REGULAR_SEASON_WEEKS missing from that dict is the bye."""
    config = config or ESPNConfig()
    league = _get_league(config, season)
    player = league.player_info(playerId=espn_player_id)
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
        "season_projected_points": player.projected_total_points,
        "season_avg_projected_points": player.projected_avg_points,
        "percent_owned": player.percent_owned,
        "percent_started": player.percent_started,
        "bye_week": bye_week,
        "next_opponent": next_game["team"] if next_game else None,
        "current_week": current_week,
    }
