"""
Backing queries for the admin dashboard's Errors, Security, and Audit
Log pages, and the nav's attention badges. The tables are written by
app/monitoring.py; see migrations/versions/b4d8e2f6a1c3_* for their
shape.
"""


def _window(days: int) -> str:
    return str(int(days))


async def get_errors(conn, days: int) -> dict:
    """One row per distinct error (fingerprint), busiest first, with
    how many people hit it and when it was first/last seen."""
    window = _window(days)
    groups = await conn.fetch(
        """
        SELECT fingerprint,
               (array_agg(source ORDER BY created_at DESC))[1] AS source,
               (array_agg(message ORDER BY created_at DESC))[1] AS message,
               (array_agg(route ORDER BY created_at DESC))[1] AS route,
               count(*) AS occurrences,
               count(DISTINCT coalesce(owner_id::text, user_id::text)) AS affected,
               min(created_at) AS first_seen,
               max(created_at) AS last_seen
        FROM app_errors
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY fingerprint
        ORDER BY max(created_at) DESC
        LIMIT 100
        """,
        window,
    )
    totals = await conn.fetchrow(
        """
        SELECT count(*) AS occurrences,
               count(*) FILTER (WHERE source = 'server') AS server,
               count(*) FILTER (WHERE source = 'client') AS client,
               count(DISTINCT fingerprint) AS kinds
        FROM app_errors
        WHERE created_at >= now() - ($1 || ' days')::interval
        """,
        window,
    )
    # First-ever sighting per fingerprint, to flag brand-new bugs.
    first_ever = {
        r["fingerprint"]: r["first"]
        for r in await conn.fetch(
            "SELECT fingerprint, min(created_at) AS first FROM app_errors WHERE fingerprint = ANY($1::text[]) GROUP BY 1",
            [g["fingerprint"] for g in groups],
        )
    }
    return {
        "window_days": days,
        **dict(totals),
        "groups": [{**dict(g), "first_ever": first_ever.get(g["fingerprint"])} for g in groups],
    }


async def get_error_detail(conn, fingerprint: str) -> dict | None:
    """Every recent occurrence of one error, with its full stack, who
    hit it, and on what device."""
    rows = await conn.fetch(
        """
        SELECT e.created_at, e.source, e.message, e.stack, e.route, e.method, e.status_code,
               e.platform, e.os, e.screen,
               coalesce(o.display_name, u.display_name) AS who
        FROM app_errors e
        LEFT JOIN owners o ON o.owner_id = e.owner_id
        LEFT JOIN users u ON u.id = e.user_id
        WHERE e.fingerprint = $1
        ORDER BY e.created_at DESC
        LIMIT 50
        """,
        fingerprint,
    )
    if not rows:
        return None
    daily = await conn.fetch(
        """
        SELECT (created_at AT TIME ZONE 'America/Chicago')::date AS day, count(*) AS occurrences
        FROM app_errors WHERE fingerprint = $1 AND created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1
        """,
        fingerprint,
    )
    return {
        "fingerprint": fingerprint,
        "occurrences": [dict(r) for r in rows],
        "daily": [dict(r) for r in daily],
    }


async def get_security(conn, days: int) -> dict:
    window = _window(days)
    by_kind = await conn.fetch(
        """
        SELECT kind, count(*) AS events, count(DISTINCT ip) AS ips
        FROM security_events
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY kind ORDER BY events DESC
        """,
        window,
    )
    top_ips = await conn.fetch(
        """
        SELECT ip, count(*) AS events,
               count(*) FILTER (WHERE kind = 'login_failed') AS failed_logins,
               count(DISTINCT email) FILTER (WHERE email IS NOT NULL) AS emails_tried,
               max(created_at) AS last_seen
        FROM security_events
        WHERE created_at >= now() - ($1 || ' days')::interval AND ip IS NOT NULL
        GROUP BY ip ORDER BY events DESC LIMIT 15
        """,
        window,
    )
    top_paths = await conn.fetch(
        """
        SELECT path, kind, count(*) AS events
        FROM security_events
        WHERE created_at >= now() - ($1 || ' days')::interval AND kind <> 'login_failed'
        GROUP BY path, kind ORDER BY events DESC LIMIT 15
        """,
        window,
    )
    targeted = await conn.fetch(
        """
        SELECT email, count(*) AS failed_logins, count(DISTINCT ip) AS ips, max(created_at) AS last_seen,
               EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = s.email) AS real_account
        FROM security_events s
        WHERE kind = 'login_failed' AND email IS NOT NULL
          AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY email ORDER BY failed_logins DESC LIMIT 15
        """,
        window,
    )
    recent = await conn.fetch(
        """
        SELECT s.created_at, s.kind, s.email, s.ip, s.method, s.path, s.user_agent, u.display_name AS who
        FROM security_events s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.created_at >= now() - ($1 || ' days')::interval
        ORDER BY s.created_at DESC LIMIT 50
        """,
        window,
    )
    return {
        "window_days": days,
        "by_kind": [dict(r) for r in by_kind],
        "top_ips": [dict(r) for r in top_ips],
        "top_paths": [dict(r) for r in top_paths],
        "targeted_accounts": [dict(r) for r in targeted],
        "recent": [dict(r) for r in recent],
    }


async def get_audit_log(conn, limit: int, offset: int) -> dict:
    rows = await conn.fetch(
        """
        SELECT a.id, a.created_at, a.action, a.method, a.path, a.target, a.status_code,
               u.display_name AS actor, a.actor_user_id
        FROM admin_audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )
    total = await conn.fetchval("SELECT count(*) FROM admin_audit_log")
    return {"total": total, "entries": [dict(r) for r in rows]}


async def get_badges(conn) -> dict:
    """Counts for the admin nav's attention dots — last 24 hours."""
    row = await conn.fetchrow(
        """
        SELECT
            (SELECT count(*) FROM analytics_events
             WHERE event_name = 'app_crash' AND created_at > now() - interval '24 hours') AS crashes,
            (SELECT count(DISTINCT fingerprint) FROM app_errors
             WHERE created_at > now() - interval '24 hours') AS errors,
            (SELECT count(*) FROM security_events
             WHERE kind = 'login_failed' AND created_at > now() - interval '24 hours') AS security
        """
    )
    return dict(row)
