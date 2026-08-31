"""
Ported from Fantasy_Helper's bot/awards_engine/expected_score.py,
unchanged (see MIGRATION_MAP.md: "EXTRACT / PORT — keep the calculation
logic itself unchanged").

Returns the best available baseline for "what this team was expected
to score" -- real ESPN projection when it exists (current/future
seasons), falling back to the league-wide average score that week for
historical seasons where ESPN doesn't retain projections.
"""

from app.config import DEFAULT_LEAGUE_ID


async def get_expected_score(conn, season: int, week: int, team_id: int, league_id: int = DEFAULT_LEAGUE_ID) -> float:
    projected = await conn.fetchval(
        "SELECT team_points_projected FROM weekly_team_stats WHERE season = $1 AND week = $2 AND team_id = $3",
        season, week, team_id,
    )
    if projected and float(projected) > 0:
        return float(projected)

    all_scores = await conn.fetch(
        """
        SELECT home_score AS s FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3 AND home_score > 0
        UNION ALL
        SELECT away_score AS s FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3 AND home_score > 0
        """,
        season, week, league_id,
    )
    if not all_scores:
        return 0.0

    return sum(float(r["s"]) for r in all_scores) / len(all_scores)
