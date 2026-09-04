"""
Backing query for the admin Overview page's real KPI cards
(app/routers/admin.py's GET /admin/overview). Deliberately a small,
honest set — DAU/WAU/MAU trends, retention, sessions/avg-session-
length, and error rate are NOT here: they either need weeks of
accumulated analytics_events history to mean anything (retention,
trend lines) or a subsystem that doesn't exist yet (error tracking).
Shipping a near-zero or single-day DAU number as a headline KPI the
day this feature ships would be real data read as a false signal
("the app has no users"), not fabrication exactly, but not useful
either — tracking_started_at lets the frontend caption every number
with "since {date}" so a small number reads as "collection just
started," not "nobody's here."
"""
async def get_overview(conn, days: int) -> dict:
    total_users = await conn.fetchval("SELECT count(*) FROM users")
    new_users = await conn.fetchval(
        f"SELECT count(*) FROM users WHERE created_at >= now() - interval '{int(days)} days'"
    )
    active_users = await conn.fetchval(
        f"SELECT count(DISTINCT owner_id) FROM analytics_events WHERE created_at >= now() - interval '{int(days)} days'"
    )
    total_leagues = await conn.fetchval("SELECT count(*) FROM leagues")
    active_leagues = await conn.fetchval(
        f"""
        SELECT count(DISTINCT lm.league_id) FROM league_members lm
        JOIN owners o ON o.user_id = lm.user_id
        JOIN analytics_events ae ON ae.owner_id = o.owner_id
        WHERE ae.created_at >= now() - interval '{int(days)} days'
        """
    )
    tracking_started_at = await conn.fetchval("SELECT min(created_at) FROM analytics_events")
    return {
        "window_days": days,
        "total_users": total_users,
        "new_users": new_users,
        "active_users": active_users,
        "total_leagues": total_leagues,
        "active_leagues": active_leagues,
        "tracking_started_at": tracking_started_at,
    }
