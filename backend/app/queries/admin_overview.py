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
    # How many real, historical owners (pre-dating real accounts) have
    # actually been claimed by a signed-up account (see leagues.py's
    # claim_owner) — a genuine adoption-depth signal distinct from
    # total_users: someone can sign up and never claim/link at all
    # (see the recent "No team found for this owner" bug this exact
    # gap caused).
    total_owners_claimed = await conn.fetchval("SELECT count(*) FROM owners WHERE user_id IS NOT NULL")
    tracking_started_at = await conn.fetchval("SELECT min(created_at) FROM analytics_events")
    return {
        "window_days": days,
        "total_users": total_users,
        "new_users": new_users,
        "active_users": active_users,
        "total_leagues": total_leagues,
        "active_leagues": active_leagues,
        "total_owners_claimed": total_owners_claimed,
        "tracking_started_at": tracking_started_at,
    }


async def get_timeseries(conn, days: int) -> list[dict]:
    """Daily signups, event volume, and distinct active owners over the
    trailing `days` window — zero-filled via generate_series so a real
    quiet day shows as 0, not a gap a line chart would silently skip.
    Genuinely sparse today (analytics_events collection only started
    2026-09) — this is real infrastructure meant to become meaningful
    as more days accumulate, not a chart dressed up to look busier than
    the data actually is (see ADMIN_DASHBOARD.md's own caution on why a
    trend line needs real history first)."""
    rows = await conn.fetch(
        """
        WITH days AS (
            SELECT generate_series(
                (now() - ($1 || ' days')::interval)::date,
                now()::date,
                '1 day'
            )::date AS day
        ),
        signups AS (
            SELECT created_at::date AS day, count(*) AS signups
            FROM users GROUP BY 1
        ),
        events AS (
            SELECT created_at::date AS day, count(*) AS events, count(DISTINCT owner_id) AS active_owners
            FROM analytics_events GROUP BY 1
        )
        SELECT d.day, coalesce(s.signups, 0)::int AS signups,
               coalesce(e.events, 0)::int AS events, coalesce(e.active_owners, 0)::int AS active_owners
        FROM days d
        LEFT JOIN signups s ON s.day = d.day
        LEFT JOIN events e ON e.day = d.day
        ORDER BY d.day
        """,
        str(days),
    )
    return [dict(r) for r in rows]


async def get_recent_activity(conn, limit: int) -> list[dict]:
    """A real, cross-cutting "what's happening right now" feed — new
    signups, league creations, feedback submissions, merged and sorted
    by recency. Same "real events, nothing invented" rule as the rest
    of this dashboard; no click-level or per-request logging (see
    ADMIN_DASHBOARD.md's own note on why that's deliberately out of
    scope)."""
    rows = await conn.fetch(
        """
        (SELECT 'signup' AS kind, coalesce(display_name, 'A new member') AS label, created_at FROM users ORDER BY created_at DESC LIMIT $1)
        UNION ALL
        (SELECT 'league_created' AS kind, name AS label, created_at FROM leagues ORDER BY created_at DESC LIMIT $1)
        UNION ALL
        (SELECT 'feedback' AS kind, submitted_by AS label, created_at FROM feedback ORDER BY created_at DESC LIMIT $1)
        ORDER BY created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


async def get_alerts(conn) -> list[dict]:
    """Rule-based, entirely real — a plain threshold check over data
    this dashboard already has, never a fabricated error/security-
    monitoring feed (that needs its own logging pipeline that doesn't
    exist yet — see ADMIN_DASHBOARD.md's Phase 2 list)."""
    alerts: list[dict] = []

    unclaimed = await conn.fetchval(
        """
        SELECT count(DISTINCT o.owner_id) FROM owners o
        JOIN teams_by_season t ON t.owner_id = o.owner_id
        WHERE o.user_id IS NULL
        """
    )
    if unclaimed:
        alerts.append(
            {
                "severity": "info",
                "message": f"{unclaimed} historical owner{'s' if unclaimed != 1 else ''} not yet claimed by a real account",
            }
        )

    no_league = await conn.fetchval(
        "SELECT count(*) FROM users u LEFT JOIN owners o ON o.user_id = u.id WHERE o.owner_id IS NULL"
    )
    if no_league:
        alerts.append(
            {
                "severity": "info",
                "message": f"{no_league} signed-up account{'s' if no_league != 1 else ''} never linked to an owner",
            }
        )

    deadlines = await conn.fetch(
        """
        SELECT l.name AS league_name, lkr.keeper_deadline
        FROM league_keeper_rules lkr
        JOIN leagues l ON l.id = lkr.league_id
        WHERE lkr.locked_at IS NULL AND lkr.keeper_deadline IS NOT NULL
          AND lkr.keeper_deadline > now() AND lkr.keeper_deadline <= now() + interval '48 hours'
        """
    )
    for d in deadlines:
        alerts.append(
            {
                "severity": "warning",
                "message": f"{d['league_name']}'s keeper deadline is in less than 48 hours and isn't locked yet",
            }
        )

    return alerts
