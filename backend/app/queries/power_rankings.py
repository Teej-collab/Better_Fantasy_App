"""
Raw SQL for Power Rankings / Luck Index / Strength of Schedule
(app/domain/power_rankings.py). The per-team-week numbers themselves
(power_rank, luck_score, sos) are already computed and stored by
app/domain/weekly_team_stats.py on every sync — nothing here computes
a stat, it only reads weekly_team_stats back in different shapes. The
all-time leaderboards read straight from weekly_team_stats at request
time, same "no separate table, no recompute job" convention
app/queries/records.py already uses for the record book.
"""

_MIN_WEEKS_FOR_ALL_TIME = 4  # guards a one-week fluke from topping a career leaderboard


async def get_week_power_rankings(conn, season: int, week: int):
    """This week's ranking plus the same team's power_rank from the
    immediately prior week (null if there isn't one, e.g. week 1) —
    the frontend turns that pair into a movement arrow."""
    return await conn.fetch(
        """
        SELECT
            w.team_id, t.team_name, o.owner_id, o.display_name AS owner_name,
            w.power_rank, w.luck_score, w.sos,
            prev.power_rank AS prev_power_rank
        FROM weekly_team_stats w
        JOIN teams_by_season t ON t.id = w.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        LEFT JOIN weekly_team_stats prev
            ON prev.team_id = w.team_id AND prev.season = w.season AND prev.week = w.week - 1
        WHERE w.season = $1 AND w.week = $2 AND w.power_rank IS NOT NULL
        ORDER BY w.power_rank
        """,
        season, week,
    )


async def get_latest_ranked_week(conn, season: int) -> int | None:
    return await conn.fetchval(
        "SELECT MAX(week) FROM weekly_team_stats WHERE season = $1 AND power_rank IS NOT NULL", season
    )


async def get_season_power_rank_trend(conn, season: int):
    return await conn.fetch(
        """
        SELECT w.team_id, t.team_name, o.owner_id, o.display_name AS owner_name, w.week, w.power_rank
        FROM weekly_team_stats w
        JOIN teams_by_season t ON t.id = w.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE w.season = $1 AND w.power_rank IS NOT NULL
        ORDER BY t.id, w.week
        """,
        season,
    )


async def most_weeks_at_number_one(conn, limit: int):
    return await conn.fetch(
        """
        SELECT o.owner_id, o.display_name AS owner_name, COUNT(*) AS value
        FROM weekly_team_stats w
        JOIN teams_by_season t ON t.id = w.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE w.power_rank = 1
        GROUP BY o.owner_id, o.display_name
        ORDER BY value DESC
        LIMIT $1
        """,
        limit,
    )


async def career_avg_power_rank(conn, limit: int, *, descending: bool):
    order = "DESC" if descending else "ASC"
    return await conn.fetch(
        f"""
        SELECT o.owner_id, o.display_name AS owner_name, AVG(w.power_rank) AS value, COUNT(*) AS weeks
        FROM weekly_team_stats w
        JOIN teams_by_season t ON t.id = w.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE w.power_rank IS NOT NULL
        GROUP BY o.owner_id, o.display_name
        HAVING COUNT(*) >= {_MIN_WEEKS_FOR_ALL_TIME}
        ORDER BY value {order}
        LIMIT $1
        """,
        limit,
    )


async def career_avg_luck(conn, limit: int, *, descending: bool):
    order = "DESC" if descending else "ASC"
    return await conn.fetch(
        f"""
        SELECT o.owner_id, o.display_name AS owner_name, AVG(w.luck_score) AS value, COUNT(*) AS weeks
        FROM weekly_team_stats w
        JOIN teams_by_season t ON t.id = w.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE w.luck_score IS NOT NULL
        GROUP BY o.owner_id, o.display_name
        HAVING COUNT(*) >= {_MIN_WEEKS_FOR_ALL_TIME}
        ORDER BY value {order}
        LIMIT $1
        """,
        limit,
    )


async def career_avg_sos(conn, limit: int, *, descending: bool):
    order = "DESC" if descending else "ASC"
    return await conn.fetch(
        f"""
        SELECT o.owner_id, o.display_name AS owner_name, AVG(w.sos) AS value, COUNT(*) AS weeks
        FROM weekly_team_stats w
        JOIN teams_by_season t ON t.id = w.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE w.sos IS NOT NULL
        GROUP BY o.owner_id, o.display_name
        HAVING COUNT(*) >= {_MIN_WEEKS_FOR_ALL_TIME}
        ORDER BY value {order}
        LIMIT $1
        """,
        limit,
    )
