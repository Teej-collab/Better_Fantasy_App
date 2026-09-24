"""
Hot/cold streak detection. compute_streak is ported unchanged from
Fantasy_Helper's bot/stats_engine/streaks.py (see MIGRATION_MAP.md).

get_team_streaks is a new batched version of that file's
get_team_streak — the original fetched one team's game history per
call (fine for a Discord embed built one field at a time); this fetches
every team's history in a week in one query and computes each team's
streak in Python, matching the batch-fetch discipline used elsewhere
(app/domain/weekly_awards.py's _load_week_context, find_game_of_the_week)
instead of N round trips for N teams.
"""


def compute_streak(recent_results: list[bool | None]) -> str:
    """recent_results: True = win, False = loss, None = tie, most recent
    LAST. A tie breaks a streak either way (2026-09-24: ties used to
    count as losses here)."""
    if len(recent_results) < 3:
        return "neutral"

    last_three = recent_results[-3:]
    if all(r is True for r in last_three):
        return "hot"
    if all(r is False for r in last_three):
        return "cold"
    return "neutral"


async def get_team_streaks(conn, season: int, team_ids: list[int]) -> dict[int, str]:
    if not team_ids:
        return {}

    games = await conn.fetch(
        """
        SELECT team_id, week, my_score, opp_score FROM (
            SELECT home_team_id AS team_id, week, home_score AS my_score, away_score AS opp_score
            FROM matchups
            WHERE season = $1 AND home_team_id = ANY($2::int[]) AND home_score IS NOT NULL
              AND away_score IS NOT NULL AND NOT (home_score = 0 AND away_score = 0)
            UNION ALL
            SELECT away_team_id AS team_id, week, away_score AS my_score, home_score AS opp_score
            FROM matchups
            WHERE season = $1 AND away_team_id = ANY($2::int[]) AND home_score IS NOT NULL
              AND away_score IS NOT NULL AND NOT (home_score = 0 AND away_score = 0)
        ) x
        ORDER BY team_id, week
        """,
        season, team_ids,
    )

    by_team: dict[int, list[bool]] = {tid: [] for tid in team_ids}
    for g in games:
        by_team[g["team_id"]].append(None if g["my_score"] == g["opp_score"] else g["my_score"] > g["opp_score"])

    return {tid: compute_streak(results) for tid, results in by_team.items()}
