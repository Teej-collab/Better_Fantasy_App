"""
The live-game service — the one place in the app that holds current
Gamecast state in memory (dict[game_id, LiveGame]), refreshed by the
scheduler's poll job (app/scheduler.py's gamecast job) or on-demand by
a cache-miss REST/WS request, and computes fantasy-impact deltas by
diffing ESPN's own already-synced rosters.points_scored over time —
not by inventing a second scoring system (see the architecture plan:
this app has no fantasy scoring rules engine at all, points_scored is
always ESPN's own already-computed number, copied verbatim during
sync; comparing two snapshots of that same number over time is a
diff, not new scoring logic).

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

# Last-seen points_scored per game_id -> player_name -> points. Keyed
# by name rather than espn_player_id: that column is only populated for
# weeks synced after it was added (see api.ts's RosterPlayer.player_id
# comment on the frontend side of this same gap) — name is always
# present, and a same-name collision within one real NFL team's active
# roster is rare enough not to matter for a purely informational panel.
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

    rows = await queries.get_rostered_players_by_pro_team(
        conn, season, week, [game.home_team.abbr, game.away_team.abbr]
    )
    baseline = _last_points.setdefault(game.game_id, {})
    events: list[dict] = []
    for row in rows:
        current = float(row["points_scored"]) if row["points_scored"] is not None else 0.0
        key = row["player_name"]
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
