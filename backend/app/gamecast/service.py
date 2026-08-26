"""
The live-game service — the one place in the app that holds current
Gamecast state in memory (dict[game_id, LiveGame]), refreshed by the
scheduler's poll job (app/scheduler.py's gamecast job) or on-demand by
a cache-miss REST/WS request, and computes fantasy-impact deltas by
diffing player_week_stats.fantasy_points over time — Phase D's own
scoring engine output (app/domain/scoring_engine.py), not ESPN's. This
used to diff ESPN's already-synced rosters.points_scored (see git
history) back when this app had no scoring engine of its own; now that
it does, comparing two snapshots of the computed points over time is
still just a diff, not new scoring logic — the computation itself
lives entirely in Phase D's own modules, not here.

Deliberately no database table for live game state — it's ephemeral by
nature (a snapshot of something still changing), and correct again on
the very next poll even if a redeploy loses the in-memory cache, so
persisting every tick would just be writes for data with no lasting
value.
"""
from app.gamecast.models import LiveGame
from app.gamecast.providers import get_nfl_data_provider
from app.providers.espn.config import ESPNConfig
from app.queries import league as queries

_current_state: dict[str, LiveGame] = {}

# Last-seen fantasy_points per game_id -> sleeper_player_id -> points.
# Keyed by sleeper_player_id (a real, always-present stable id — unlike
# the legacy `rosters` table's espn_player_id, which was only partially
# backfilled and forced a player_name-keyed workaround here before the
# ESPN-independence pivot).
_last_points: dict[str, dict[str, float]] = {}


def get_cached_state(game_id: str) -> LiveGame | None:
    return _current_state.get(game_id)


def all_cached_states() -> list[LiveGame]:
    return list(_current_state.values())


async def refresh_game(conn, game_id: str) -> tuple[LiveGame, list[dict]]:
    """Fetches the latest state from the configured provider, updates
    the in-memory cache, and returns (new_state, fantasy_impact_events)
    — events is empty unless some rostered player's points_scored
    actually moved since the last time this was called for this game."""
    provider = get_nfl_data_provider()
    game = await provider.get_game_state(game_id)
    _current_state[game_id] = game
    events = await _diff_fantasy_impact(conn, game)
    return game, events


async def _diff_fantasy_impact(conn, game: LiveGame) -> list[dict]:
    espn_config = ESPNConfig()
    season = espn_config.active_season
    week = await queries.get_cached_current_week(conn, season)
    if week is None:
        return []

    rows = await queries.get_current_rostered_players_by_pro_team(
        conn, season, week, [game.home_team.abbr, game.away_team.abbr]
    )
    baseline = _last_points.setdefault(game.game_id, {})
    events: list[dict] = []
    for row in rows:
        current = float(row["points_scored"]) if row["points_scored"] is not None else 0.0
        key = row["player_id"]
        previous = baseline.get(key)
        if previous is not None and current != previous:
            events.append(
                {
                    "type": "fantasy_impact",
                    "player_name": row["player_name"],
                    "pro_team": row["pro_team"],
                    "owner_id": row["owner_id"],
                    "owner_name": row["owner_name"],
                    "team_name": row["team_name"],
                    "points_scored": current,
                    "delta": round(current - previous, 2),
                }
            )
        baseline[key] = current
    return events
