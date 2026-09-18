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
from app.auth.league_context import resolve_active_league_id, resolve_owner_id
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


_TOP_N = 3


async def build_fantasy_impact(conn, game: LiveGame, payload: dict | None) -> dict:
    """The Gamecast "Fantasy Impact" panel's real data, per the
    2026-09-18 redesign (real fantasy_points, not just "mentioned in a
    play" — see FantasyImpact.tsx's own history): the signed-in
    owner's own top-scoring rostered players in this specific real NFL
    game, the same for their current weekly H2H opponent, and — always,
    even signed out — the real top-3 scorers on each of the two real
    NFL teams playing, league-wide, independent of fantasy rostering
    (get_top_scorers_by_pro_team's own docstring on why that's a
    separate query from the rostered-players one above).

    Uses the game's own season/week (not "current week") to resolve
    whose players are on the field — this is the real NFL week this
    particular game belongs to, which is the only correct scope for a
    specific game's box score even in the rare case it drifts from the
    league's own cached current_week."""
    pro_teams = [game.home_team.abbr, game.away_team.abbr]

    your_team = None
    your_players: list[dict] = []
    opponent_team = None
    opponent_players: list[dict] = []

    if payload is not None:
        # resolve_active_league_id (not require_active_league_id): a
        # signed-in visitor with no active league selected yet should
        # still see game_leaders below, not have the whole request
        # fail with a 409 just because your_players/opponent_players
        # can't be resolved without a real league — same reasoning as
        # every other public-preview-friendly read this helper's own
        # docstring lists.
        league_id = await resolve_active_league_id(conn, payload)
        my_owner_id = await resolve_owner_id(conn, payload)
        my_team = await conn.fetchrow(
            "SELECT id AS team_id, team_name FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            game.season, my_owner_id, league_id,
        )
        if my_team is not None:
            opp_team_id = None
            opp_team_name = None
            matchup = await queries.get_matchup_for_team(conn, my_team["team_id"], game.season, game.week, league_id)
            if matchup is not None:
                is_home = matchup["home_team_id"] == my_team["team_id"]
                opp_team_id = matchup["away_team_id"] if is_home else matchup["home_team_id"]
                opp_team_name = matchup["away_team_name"] if is_home else matchup["home_team_name"]

            rows = await queries.get_current_rostered_players_by_pro_team(
                conn, game.season, game.week, pro_teams, league_id
            )
            for r in rows:
                entry = {
                    "player_id": r["player_id"],
                    "player_name": r["player_name"],
                    "position": r["position"],
                    "pro_team": r["pro_team"],
                    "points_scored": float(r["points_scored"]),
                }
                if r["team_id"] == my_team["team_id"]:
                    your_players.append(entry)
                elif opp_team_id is not None and r["team_id"] == opp_team_id:
                    opponent_players.append(entry)

            your_players.sort(key=lambda e: e["points_scored"], reverse=True)
            opponent_players.sort(key=lambda e: e["points_scored"], reverse=True)
            your_team = {"team_id": my_team["team_id"], "team_name": my_team["team_name"]}
            if opp_team_id is not None:
                opponent_team = {"team_id": opp_team_id, "team_name": opp_team_name}

    leader_rows = await queries.get_top_scorers_by_pro_team(
        conn, game.season, game.week, pro_teams, limit=_TOP_N
    )
    leaders_by_team: dict[str, list[dict]] = {abbr: [] for abbr in pro_teams}
    for r in leader_rows:
        leaders_by_team.setdefault(r["pro_team"], []).append(
            {
                "player_id": r["player_id"],
                "player_name": r["player_name"],
                "position": r["position"],
                "points_scored": float(r["points_scored"]),
            }
        )

    return {
        "your_team": your_team,
        "your_players": your_players[:_TOP_N],
        "opponent_team": opponent_team,
        "opponent_players": opponent_players[:_TOP_N],
        "game_leaders": {
            "home": {
                "abbr": game.home_team.abbr,
                "name": game.home_team.name,
                "leaders": leaders_by_team.get(game.home_team.abbr, []),
            },
            "away": {
                "abbr": game.away_team.abbr,
                "name": game.away_team.name,
                "leaders": leaders_by_team.get(game.away_team.abbr, []),
            },
        },
    }
