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
    league_id: int = DEFAULT_LEAGUE_ID, video_url: str | None = None,
):
    """video_url, when given, is the chug video's object key in the
    chug-videos bucket (app/providers/chug_storage.py) — not a public
    URL. It's null whenever storage isn't configured or the upload
    itself failed (see app/routers/chug.py's upload endpoint), same as
    the original Discord bot which never persisted the video at all;
    the grade/debt effect of a chug never depends on whether its video
    made it to storage."""
    return await conn.fetchrow(
        """
        INSERT INTO chug_scores
            (discord_user_id, chug_time_seconds, smoothness_score, hype_score, final_score, season, week, league_id, video_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, created_at
        """,
        discord_user_id, duration_seconds, smoothness_score, hype_score, final_score, season, week, league_id, video_url,
    )


async def list_recent_chugs(conn, league_id: int, season: int | None = None, limit: int = 25):
    """Individual graded chugs (not the aggregate leaderboard totals in
    get_chug_completions) for the "Recent Chugs" feed — newest first,
    each with whatever's needed to render a card and, if video_url is
    set, a play button. video_url is the bucket's own object key, never
    handed to the frontend directly — app/routers/chug.py's GET
    /chug/{id}/video exchanges it for a short-lived presigned URL after
    checking real league membership, since these videos are exactly as
    private as the rest of this league's chug data."""
    if season is not None:
        return await conn.fetch(
            """
            SELECT cs.id, owners.owner_id, owners.display_name AS owner_name, cs.week,
                   cs.final_score, cs.created_at, (cs.video_url IS NOT NULL) AS has_video, cs.roast
            FROM chug_scores cs
            JOIN owners ON owners.discord_user_id = cs.discord_user_id
            WHERE cs.league_id = $1 AND cs.season = $2
            ORDER BY cs.created_at DESC
            LIMIT $3
            """,
            league_id, season, limit,
        )
    return await conn.fetch(
        """
        SELECT cs.id, owners.owner_id, owners.display_name AS owner_name, cs.week,
               cs.final_score, cs.created_at, (cs.video_url IS NOT NULL) AS has_video, cs.roast
        FROM chug_scores cs
        JOIN owners ON owners.discord_user_id = cs.discord_user_id
        WHERE cs.league_id = $1
        ORDER BY cs.created_at DESC
        LIMIT $2
        """,
        league_id, limit,
    )


async def get_chug_video_key(conn, chug_id: int, league_id: int) -> str | None:
    """Scoped to league_id so a member of one league can never be handed
    a presigned URL for another league's chug video, even by guessing an
    id — same membership boundary every other /chug endpoint enforces."""
    return await conn.fetchval(
        "SELECT video_url FROM chug_scores WHERE id = $1 AND league_id = $2",
        chug_id, league_id,
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


async def get_doubled_weeks_by_owner(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """Settlements that doubled an owner's balance and haven't been
    waived — what a commissioner can still reverse (see
    app/domain/chug_standing.py's waive_deadline_doubling)."""
    rows = await conn.fetch(
        "SELECT owner_id, week, owed_before, owed_after FROM chug_deadline_settlements "
        "WHERE season = $1 AND league_id = $2 AND action = 'doubled' ORDER BY week",
        season, league_id,
    )
    by_owner: dict[int, list[dict]] = {}
    for r in rows:
        by_owner.setdefault(r["owner_id"], []).append(
            {"week": r["week"], "owed_before": r["owed_before"], "owed_after": r["owed_after"]}
        )
    return by_owner
