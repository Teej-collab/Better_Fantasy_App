"""
Computes and stores a week's fantasy points — individual players AND
team D/ST units — for the ESPN-independence pivot's Phase D. The
orchestration layer over app/providers/nfl_stats/espn_public.py (raw
stats) and app/domain/scoring_engine.py (the formula).

Both kinds of "player" land in the same player_week_stats table,
keyed by sleeper_player_id: an individual's real Sleeper id for
offensive/defensive players, or a team abbreviation (e.g. "KC") for a
D/ST unit — matching how app/providers/sleeper/ingest.py already
special-cases DEF entries in the `players` table itself, so there's no
separate "is this a team or a person" schema split to carry through
the rest of the app (current_rosters, lineup slots, etc. already treat
a DEF row as just another player).

compute_week_stats() takes explicit event_ids so it stays independently
testable; compute_and_store_week() (bottom of this file) is the real
entry point — it sources those event_ids itself from
app/providers/nfl_scoreboard.py's get_week_scoreboard(), then also
recomputes matchup scores (Phase F) from the result. That's the single
function app/scheduler.py's weekly-compute job and the commissioner's
manual /admin/weekly-compute trigger both call.
"""
import json

from app.domain.matchup_scoring import compute_matchup_scores_for_week
from app.domain.scoring_engine import DST_BASELINE_POINTS, compute_player_points, rules_dict_from_rows
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.providers.nfl_stats.espn_public import get_game_stats


async def _upsert_player_week_stat(conn, season: int, week: int, sleeper_player_id: str, stat_line: dict, points: float) -> None:
    await conn.execute(
        """
        INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, computed_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (season, week, sleeper_player_id) DO UPDATE SET
            raw_stats = EXCLUDED.raw_stats,
            fantasy_points = EXCLUDED.fantasy_points,
            computed_at = now()
        """,
        season, week, sleeper_player_id, json.dumps(stat_line), points,
    )


async def compute_week_stats(conn, season: int, week: int, event_ids: list[str]) -> dict[str, int]:
    """Fetches raw stats for every given event (one network round-trip
    per event, covering both individual players and team D/ST — see
    get_game_stats), computes points against this season's real
    scoring rules, and upserts one row per player/team into
    player_week_stats. Returns {"players": n, "team_dst": n} counts.

    An individual player whose espn_player_id doesn't crosswalk to any
    row in `players` is silently skipped — not every ESPN athlete that
    touches a game is a real fantasy-relevant player, and the
    crosswalk itself is only partially populated pre-season (see
    app/providers/sleeper/ingest.py's canary log). A team D/ST stat
    line with no matching `players` row (sleeper_player_id = team
    abbreviation) is also silently skipped — shouldn't happen once
    Phase A's Sleeper ingestion has run (it seeds all 32 real teams),
    but a mid-season abbreviation mismatch shouldn't crash the whole
    week's compute either."""
    rule_rows = await conn.fetch(
        "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE season = $1", season
    )
    rules = rules_dict_from_rows(rule_rows)
    if not rules:
        raise ValueError(f"No league_scoring_rules configured for season {season}")

    crosswalk_rows = await conn.fetch(
        "SELECT espn_player_id, sleeper_player_id FROM players WHERE espn_player_id IS NOT NULL"
    )
    espn_to_sleeper = {row["espn_player_id"]: row["sleeper_player_id"] for row in crosswalk_rows}

    dst_rows = await conn.fetch("SELECT sleeper_player_id FROM players WHERE position = 'DEF'")
    known_dst_ids = {row["sleeper_player_id"] for row in dst_rows}

    counts = {"players": 0, "team_dst": 0}
    async with conn.transaction():
        for event_id in event_ids:
            game = await get_game_stats(event_id)

            for player in game["players"]:
                sleeper_id = espn_to_sleeper.get(player["espn_player_id"])
                if sleeper_id is None:
                    continue
                points = compute_player_points(player["stat_line"], rules)
                await _upsert_player_week_stat(conn, season, week, sleeper_id, player["stat_line"], points)
                counts["players"] += 1

            for team_abbr, stat_line in game["team_dst"].items():
                if team_abbr not in known_dst_ids:
                    continue
                # This league's real D/ST scoring starts every team at
                # 10 points before its own events are added/subtracted
                # (confirmed by the project owner, Aug 26 2026) —
                # individual players get no such baseline.
                points = compute_player_points(stat_line, rules, baseline=DST_BASELINE_POINTS)
                await _upsert_player_week_stat(conn, season, week, team_abbr, stat_line, points)
                counts["team_dst"] += 1

    return counts


async def compute_and_store_week(pool, season: int, week: int) -> dict:
    """The real weekly-compute entry point: pulls this fantasy week's
    real NFL event ids from ESPN's public scoreboard, stores every
    player/team-D-ST's fantasy points for the week (compute_week_stats
    above), then recomputes matchups.home_score/away_score from that
    result (app/domain/matchup_scoring.py, Phase F). This league's
    fantasy weeks are always real NFL regular-season weeks (see
    nfl_scoreboard.py's SEASON_TYPE_REGULAR docstring), and the `year`
    ESPN's scoreboard wants for a regular-season week is just the
    season itself."""
    games = await get_week_scoreboard(week=week, year=season)
    event_ids = [g["id"] for g in games if g["id"]]

    async with pool.acquire() as conn:
        stat_counts = await compute_week_stats(conn, season, week, event_ids)
        matchups_updated = await compute_matchup_scores_for_week(conn, season, week)

    return {"event_count": len(event_ids), **stat_counts, "matchups_updated": matchups_updated}
