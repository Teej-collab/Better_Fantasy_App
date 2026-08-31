"""
Chug leaderboard read queries. Owed totals come from chug_debts (the
auto-computed rule — see app/domain/chug_debt.py); real completion
counts and average grades come from chug_scores (actual graded videos),
matched to an owner via owners.discord_user_id the same way
Fantasy_Helper's /chug_leaderboard embed did (chug_scores predates any
owner_id column of its own).
"""

from app.config import DEFAULT_LEAGUE_ID


async def list_chug_seasons(conn, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        "SELECT DISTINCT season FROM chug_debts WHERE league_id = $1 ORDER BY season", league_id
    )


async def get_chug_owed_by_owner(conn, season: int | None, league_id: int = DEFAULT_LEAGUE_ID):
    if season is not None:
        return await conn.fetch(
            "SELECT owner_id, SUM(chugs_owed) AS total_owed FROM chug_debts "
            "WHERE season = $1 AND league_id = $2 GROUP BY owner_id",
            season, league_id,
        )
    return await conn.fetch(
        "SELECT owner_id, season, SUM(chugs_owed) AS total_owed FROM chug_debts "
        "WHERE league_id = $1 GROUP BY owner_id, season",
        league_id,
    )


async def insert_chug_score(
    conn, discord_user_id: int, season: int, week: int | None,
    duration_seconds: float, smoothness_score: float, hype_score: float, final_score: float,
    league_id: int = DEFAULT_LEAGUE_ID,
):
    """Video URL is deliberately never set — same as the original Discord
    bot's chug_watcher.py, which discards the uploaded file after scoring
    rather than persisting it anywhere. See app/routers/chug.py's upload
    endpoint."""
    return await conn.fetchrow(
        """
        INSERT INTO chug_scores
            (discord_user_id, chug_time_seconds, smoothness_score, hype_score, final_score, season, week, league_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, created_at
        """,
        discord_user_id, duration_seconds, smoothness_score, hype_score, final_score, season, week, league_id,
    )


async def get_chug_completions(conn, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT owners.owner_id, cs.season, COUNT(*) AS completed_count, AVG(cs.final_score) AS avg_grade
        FROM chug_scores cs
        JOIN owners ON owners.discord_user_id = cs.discord_user_id
        WHERE cs.season IS NOT NULL AND cs.league_id = $1
        GROUP BY owners.owner_id, cs.season
        """,
        league_id,
    )


async def get_lifetime_completed_by_owner(conn, league_id: int = DEFAULT_LEAGUE_ID):
    """Every real, video-graded chug ever, per owner — deliberately
    uncapped by what was ever owed (unlike get_chug_completions' role in
    the leaderboard's per-season "completed" column). This is the number
    an owner should see for "how many chugs have I ever done," including
    ones posted with nothing owed (see app/domain/chug_standing.py's
    module docstring — a "for funsies" chug still counts here)."""
    rows = await conn.fetch(
        """
        SELECT owners.owner_id, COUNT(*) AS lifetime_completed
        FROM chug_scores cs
        JOIN owners ON owners.discord_user_id = cs.discord_user_id
        WHERE cs.league_id = $1
        GROUP BY owners.owner_id
        """,
        league_id,
    )
    return {r["owner_id"]: r["lifetime_completed"] for r in rows}


async def get_chug_standing_by_owner(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    rows = await conn.fetch(
        "SELECT owner_id, outstanding_owed, fined_owed, consecutive_missed_weeks "
        "FROM chug_standing WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    return {r["owner_id"]: dict(r) for r in rows}
