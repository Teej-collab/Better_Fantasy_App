"""
Chug leaderboard read queries. Owed totals come from chug_debts (the
auto-computed rule — see app/domain/chug_debt.py); real completion
counts and average grades come from chug_scores (actual graded videos),
matched to an owner via owners.discord_user_id the same way
Fantasy_Helper's /chug_leaderboard embed did (chug_scores predates any
owner_id column of its own).
"""


async def list_chug_seasons(conn):
    return await conn.fetch("SELECT DISTINCT season FROM chug_debts ORDER BY season")


async def get_chug_owed_by_owner(conn, season: int | None):
    if season is not None:
        return await conn.fetch(
            "SELECT owner_id, SUM(chugs_owed) AS total_owed FROM chug_debts WHERE season = $1 GROUP BY owner_id",
            season,
        )
    return await conn.fetch(
        "SELECT owner_id, season, SUM(chugs_owed) AS total_owed FROM chug_debts GROUP BY owner_id, season"
    )


async def get_chug_completions(conn):
    return await conn.fetch(
        """
        SELECT owners.owner_id, cs.season, COUNT(*) AS completed_count, AVG(cs.final_score) AS avg_grade
        FROM chug_scores cs
        JOIN owners ON owners.discord_user_id = cs.discord_user_id
        WHERE cs.season IS NOT NULL
        GROUP BY owners.owner_id, cs.season
        """
    )
