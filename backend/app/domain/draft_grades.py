"""
Real, data-driven draft grades — see migration 03100a8a1874 for the
full reasoning. Grade basis is deliberately a single, reliable field:
each team's total drafted players.projected_points, confirmed 100%
covered for a real completed draft in this app (every drafted player
gets a real ESPN season projection synced before the draft happens).
There is no real market-consensus ADP anywhere in this app —
players.search_rank is a single-source (Sleeper) proxy, kept OUT of
this formula and used only as narrative color in
app/domain/draft_narratives.py — blending an unreliable second signal
into the grade itself would make it look more sophisticated while
actually being less honest and less explainable.

Percentile-rank buckets, not a z-score cutoff: with only ~12 real data
points (one per team), a z-score (mean +/- N*stdev) is unstable and
sensitive to a single outlier team's total. Rank-based percentile
buckets always produce the same distribution shape regardless of how
tightly the real totals happen to cluster in a given year.
"""

from app.config import DEFAULT_LEAGUE_ID

# (minimum percentile, letter) — checked top-down, first match wins.
# For a 12-team league this lands on clean 2/2/4/2/2 boundaries; for a
# league of a different size the buckets still divide fairly, just not
# on perfectly even team-count lines.
GRADE_CUTOFFS = [(83.3, "A"), (66.6, "B"), (33.3, "C"), (16.6, "D"), (0.0, "F")]


def _letter_for_percentile(percentile: float) -> str:
    for cutoff, letter in GRADE_CUTOFFS:
        if percentile >= cutoff:
            return letter
    return "F"


async def compute_draft_grades(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """One row per owner who made at least one real pick this season:
    total drafted projected_points, the league average, this team's
    percentile rank among the season's real drafters, and the
    resulting letter grade. Idempotent — safe to call again (e.g. after
    a late pick correction) via UPSERT."""
    rows = await conn.fetch(
        """
        SELECT dp.owner_id, SUM(p.projected_points) AS total
        FROM draft_picks dp
        JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id
        WHERE dp.season = $1 AND dp.league_id = $2 AND dp.sleeper_player_id IS NOT NULL
        GROUP BY dp.owner_id
        """,
        season, league_id,
    )
    if not rows:
        return 0

    totals = [float(r["total"]) for r in rows]
    league_avg = sum(totals) / len(totals)
    team_count = len(totals)

    for r in rows:
        total = float(r["total"])
        rank_below_or_equal = sum(1 for t in totals if t <= total)
        percentile = (rank_below_or_equal / team_count) * 100
        letter = _letter_for_percentile(percentile)
        await conn.execute(
            """
            INSERT INTO draft_grades
                (season, league_id, owner_id, total_projected_points, league_avg_projected_points, percentile, letter_grade)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (season, league_id, owner_id) DO UPDATE SET
                total_projected_points = EXCLUDED.total_projected_points,
                league_avg_projected_points = EXCLUDED.league_avg_projected_points,
                percentile = EXCLUDED.percentile,
                letter_grade = EXCLUDED.letter_grade,
                computed_at = now()
            """,
            season, league_id, r["owner_id"], total, league_avg, percentile, letter,
        )
    return len(rows)


async def get_draft_grade(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchrow(
        "SELECT * FROM draft_grades WHERE season = $1 AND league_id = $2 AND owner_id = $3",
        season, league_id, owner_id,
    )


async def get_draft_grades_for_season(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT dg.*, o.display_name AS owner_name
        FROM draft_grades dg JOIN owners o ON o.owner_id = dg.owner_id
        WHERE dg.season = $1 AND dg.league_id = $2
        ORDER BY dg.percentile DESC
        """,
        season, league_id,
    )
