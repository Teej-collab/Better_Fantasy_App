"""
Computes and stores a week's individual-player fantasy points (Phase D
of the ESPN-independence pivot) — the orchestration layer over
app/providers/nfl_stats/espn_public.py (raw stats) and
app/domain/scoring_engine.py (the formula). Deliberately scoped to
individual players only; team D/ST scoring needs its own aggregation
design (points/yards-allowed tiers, cross-referencing the opponent's
own team stats) and isn't built here yet — see TODO.md's Phase D entry.

Callers supply the event_ids for the week being computed (there's no
"which ESPN events belong to fantasy week N" mapping built yet either
— that's a real follow-up, likely sourced from
app/providers/nfl_scoreboard.py's own event list filtered by date
range once real weeks are being computed for real).
"""
import json

from app.domain.scoring_engine import compute_player_points, rules_dict_from_rows
from app.providers.nfl_stats.espn_public import get_game_player_stats


async def compute_week_player_stats(conn, season: int, week: int, event_ids: list[str]) -> int:
    """Fetches raw stats for every given event, maps each player to
    this app's own sleeper_player_id via the players.espn_player_id
    crosswalk, computes points against this season's real scoring
    rules, and upserts one row per player into player_week_stats.
    Returns the number of rows written. A player whose espn_player_id
    doesn't crosswalk to any row in `players` is silently skipped —
    not every ESPN athlete that touches a game is a real fantasy-
    relevant player (e.g. a long-snapper), and the crosswalk itself is
    only partially populated pre-season (see app/providers/sleeper/
    ingest.py's canary log)."""
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

    written = 0
    async with conn.transaction():
        for event_id in event_ids:
            for player in await get_game_player_stats(event_id):
                sleeper_id = espn_to_sleeper.get(player["espn_player_id"])
                if sleeper_id is None:
                    continue
                points = compute_player_points(player["stat_line"], rules)
                await conn.execute(
                    """
                    INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, computed_at)
                    VALUES ($1, $2, $3, $4, $5, now())
                    ON CONFLICT (season, week, sleeper_player_id) DO UPDATE SET
                        raw_stats = EXCLUDED.raw_stats,
                        fantasy_points = EXCLUDED.fantasy_points,
                        computed_at = now()
                    """,
                    season, week, sleeper_id, json.dumps(player["stat_line"]), points,
                )
                written += 1
    return written
