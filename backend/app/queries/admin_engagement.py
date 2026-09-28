"""
Backing queries for the admin dashboard's Engagement, Live, and Paths
views — all computed from data the app already records
(analytics_events, users, owner_users), no extra tracking.

Days are bucketed in America/Chicago (the league's own timezone, same
default as quiet hours), so a Sunday night game doesn't split across
two "days" the way UTC midnight would.

Activity is per owner (analytics_events is keyed by owner_id), so two
co-owners sharing a team count once — the same unit the rest of the
dashboard uses.
"""
from app.chat.manager import manager as chat_manager

TZ = "America/Chicago"


def _window(days: int) -> str:
    return str(int(days))


async def get_engagement(conn, days: int) -> dict:
    window = _window(days)

    series = await conn.fetch(
        f"""
        WITH activity AS (
            SELECT DISTINCT owner_id, (created_at AT TIME ZONE '{TZ}')::date AS day
            FROM analytics_events
            WHERE created_at >= now() - (($1::int + 30) || ' days')::interval
        ),
        days AS (
            SELECT generate_series(
                (now() AT TIME ZONE '{TZ}')::date - ($1::int - 1),
                (now() AT TIME ZONE '{TZ}')::date,
                '1 day'
            )::date AS day
        )
        SELECT d.day,
               (SELECT count(DISTINCT owner_id) FROM activity a WHERE a.day = d.day) AS dau,
               (SELECT count(DISTINCT owner_id) FROM activity a WHERE a.day BETWEEN d.day - 6 AND d.day) AS wau,
               (SELECT count(DISTINCT owner_id) FROM activity a WHERE a.day BETWEEN d.day - 29 AND d.day) AS mau
        FROM days d
        ORDER BY d.day
        """,
        int(days),
    )
    series = [dict(r) for r in series]
    last = series[-1] if series else {"dau": 0, "wau": 0, "mau": 0}
    last_30 = series[-30:]
    avg_dau = sum(r["dau"] for r in last_30) / len(last_30) if last_30 else 0
    stickiness = round(avg_dau / last["mau"], 3) if last["mau"] else None

    platforms = await conn.fetch(
        """
        SELECT coalesce(platform, 'unknown') AS platform, coalesce(device_type, 'unknown') AS device_type,
               count(DISTINCT owner_id) AS owners, count(*) AS events
        FROM analytics_events
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1, 2 ORDER BY owners DESC, events DESC
        """,
        window,
    )

    when_active = await conn.fetch(
        f"""
        SELECT extract(dow FROM created_at AT TIME ZONE '{TZ}')::int AS dow,
               extract(hour FROM created_at AT TIME ZONE '{TZ}')::int AS hour,
               count(*) AS events
        FROM analytics_events
        WHERE event_type = 'page_view' AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1, 2
        """,
        window,
    )

    sessions = await conn.fetchrow(
        """
        WITH s AS (
            SELECT session_id, count(*) AS pages,
                   extract(epoch FROM max(created_at) - min(created_at)) AS seconds
            FROM analytics_events
            WHERE event_type = 'page_view' AND created_at >= now() - ($1 || ' days')::interval
            GROUP BY session_id
        )
        SELECT count(*) AS sessions,
               coalesce(round(avg(pages)::numeric, 1), 0) AS avg_pages,
               coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds), 0) AS median_seconds
        FROM s
        """,
        window,
    )

    return {
        "window_days": days,
        "timezone": TZ,
        "summary": {
            "dau": last["dau"],
            "wau": last["wau"],
            "mau": last["mau"],
            "avg_dau": round(avg_dau, 1),
            "stickiness": stickiness,
            "sessions": sessions["sessions"],
            "avg_pages_per_session": float(sessions["avg_pages"]),
            "median_session_seconds": round(float(sessions["median_seconds"])),
        },
        "series": series,
        "platforms": [dict(r) for r in platforms],
        "when_active": [dict(r) for r in when_active],
        "retention": await _retention(conn),
        "cohorts": await _weekly_cohorts(conn),
        "funnel": await _funnel(conn),
    }


async def _retention(conn) -> list[dict]:
    """Classic Day 1/7/30 retention: of accounts old enough to have
    reached day N, the share whose owner was active on day N or later.
    `eligible` is shown alongside so a small cohort reads as small."""
    out = []
    for n in (1, 7, 30):
        row = await conn.fetchrow(
            """
            SELECT count(*) AS eligible,
                   count(*) FILTER (WHERE EXISTS (
                       SELECT 1 FROM analytics_events e
                       WHERE e.owner_id = ou.owner_id
                         AND e.created_at >= u.created_at + make_interval(days => $1)
                   )) AS retained
            FROM users u
            JOIN owner_users ou ON ou.user_id = u.id
            WHERE u.created_at <= now() - make_interval(days => $1)
            """,
            n,
        )
        eligible, retained = row["eligible"], row["retained"]
        out.append({
            "day": n,
            "eligible": eligible,
            "retained": retained,
            "rate": round(retained / eligible, 3) if eligible else None,
        })
    return out


async def _weekly_cohorts(conn) -> list[dict]:
    """Accounts grouped by signup week (last 8 weeks), and the share
    active in each following week. A week that hasn't happened yet for
    a cohort is null, not 0."""
    rows = await conn.fetch(
        f"""
        WITH cohort AS (
            SELECT u.id, ou.owner_id,
                   date_trunc('week', u.created_at AT TIME ZONE '{TZ}')::date AS week
            FROM users u JOIN owner_users ou ON ou.user_id = u.id
            WHERE u.created_at >= date_trunc('week', now() AT TIME ZONE '{TZ}') - interval '7 weeks'
        ),
        activity AS (
            SELECT DISTINCT owner_id, date_trunc('week', created_at AT TIME ZONE '{TZ}')::date AS week
            FROM analytics_events
        )
        SELECT c.week,
               count(DISTINCT c.id) AS size,
               count(DISTINCT c.id) FILTER (WHERE a.week = c.week + 7) AS w1,
               count(DISTINCT c.id) FILTER (WHERE a.week = c.week + 14) AS w2,
               count(DISTINCT c.id) FILTER (WHERE a.week = c.week + 21) AS w3,
               count(DISTINCT c.id) FILTER (WHERE a.week = c.week + 28) AS w4
        FROM cohort c
        LEFT JOIN activity a ON a.owner_id = c.owner_id
        GROUP BY c.week
        ORDER BY c.week DESC
        """
    )
    this_week = await conn.fetchval(f"SELECT date_trunc('week', now() AT TIME ZONE '{TZ}')::date")
    out = []
    for r in rows:
        weeks = []
        for i in range(1, 5):
            reached = (this_week - r["week"]).days >= 7 * i
            weeks.append(round(r[f"w{i}"] / r["size"], 3) if reached and r["size"] else None)
        out.append({"week": r["week"], "size": r["size"], "weeks": weeks})
    return out


async def _funnel(conn) -> list[dict]:
    """All-time: signed up → linked to a team → used the app → came
    back on a second day → active in the last 7 days."""
    row = await conn.fetchrow(
        """
        WITH owner_days AS (
            SELECT owner_id, count(DISTINCT created_at::date) AS days, max(created_at) AS last_seen
            FROM analytics_events GROUP BY owner_id
        )
        SELECT
            (SELECT count(*) FROM users) AS signed_up,
            (SELECT count(*) FROM users u WHERE EXISTS (SELECT 1 FROM owner_users ou WHERE ou.user_id = u.id)) AS linked,
            (SELECT count(*) FROM users u JOIN owner_users ou ON ou.user_id = u.id
             JOIN owner_days d ON d.owner_id = ou.owner_id) AS used,
            (SELECT count(*) FROM users u JOIN owner_users ou ON ou.user_id = u.id
             JOIN owner_days d ON d.owner_id = ou.owner_id WHERE d.days >= 2) AS returned,
            (SELECT count(*) FROM users u JOIN owner_users ou ON ou.user_id = u.id
             JOIN owner_days d ON d.owner_id = ou.owner_id WHERE d.last_seen > now() - interval '7 days') AS active_7d
        """
    )
    labels = [
        ("signed_up", "Signed up"),
        ("linked", "Linked to a team"),
        ("used", "Used the app"),
        ("returned", "Came back another day"),
        ("active_7d", "Active this week"),
    ]
    return [{"step": key, "label": label, "count": row[key]} for key, label in labels]


async def get_live(conn) -> dict:
    """Who's in the app right now and where: everyone with a live
    connection (chat_manager — the same signal as Online Now) plus
    anyone who opened a page in the last 5 minutes, each with the page
    they're on. Also the latest events across the whole app (minus
    admin-dashboard page views)."""
    connected = set(chat_manager.connected_owner_ids())
    people = await conn.fetch(
        """
        WITH latest AS (
            SELECT DISTINCT ON (owner_id) owner_id, route, event_name, platform, device_type, created_at
            FROM analytics_events
            WHERE event_type = 'page_view' AND created_at > now() - interval '12 hours'
            ORDER BY owner_id, created_at DESC
        )
        SELECT o.owner_id, o.display_name, l.route, l.event_name, l.platform, l.device_type,
               l.created_at AS last_seen
        FROM owners o
        LEFT JOIN latest l ON l.owner_id = o.owner_id
        WHERE o.owner_id = ANY($1::int[]) OR l.created_at > now() - interval '5 minutes'
        ORDER BY l.created_at DESC NULLS LAST
        """,
        list(connected),
    )
    feed = await conn.fetch(
        """
        SELECT e.created_at, e.event_name, e.event_type, e.route, e.platform, e.device_type, o.display_name
        FROM analytics_events e
        LEFT JOIN owners o ON o.owner_id = e.owner_id
        -- Admins browsing the dashboard itself would otherwise drown
        -- out everyone else's activity.
        WHERE e.route IS NULL OR e.route NOT LIKE '/admin%'
        ORDER BY e.created_at DESC
        LIMIT 40
        """
    )
    last_hour = await conn.fetchrow(
        """
        SELECT count(*) AS events, count(DISTINCT owner_id) AS owners
        FROM analytics_events WHERE created_at > now() - interval '1 hour'
        """
    )
    return {
        "people": [{**dict(p), "connected": p["owner_id"] in connected} for p in people],
        "feed": [dict(r) for r in feed],
        "last_hour": dict(last_hour),
    }


async def get_paths(conn, days: int) -> dict:
    """How people move through the app: the most common page-to-page
    steps, where sessions start and end, and session length."""
    window = _window(days)
    base = """
        WITH pv AS (
            SELECT session_id, event_name, created_at,
                   lag(event_name) OVER (PARTITION BY session_id ORDER BY created_at) AS prev,
                   row_number() OVER (PARTITION BY session_id ORDER BY created_at) AS n,
                   row_number() OVER (PARTITION BY session_id ORDER BY created_at DESC) AS n_rev,
                   count(*) OVER (PARTITION BY session_id) AS session_pages
            FROM analytics_events
            WHERE event_type = 'page_view' AND created_at >= now() - ($1 || ' days')::interval
        )
    """
    transitions = await conn.fetch(
        base + """
        SELECT prev AS from_page, event_name AS to_page, count(*) AS moves
        FROM pv WHERE prev IS NOT NULL AND prev <> event_name
        GROUP BY 1, 2 ORDER BY moves DESC LIMIT 40
        """,
        window,
    )
    entries = await conn.fetch(
        base + "SELECT event_name, count(*) AS sessions FROM pv WHERE n = 1 GROUP BY 1 ORDER BY 2 DESC LIMIT 12",
        window,
    )
    exits = await conn.fetch(
        base + """
        SELECT event_name, count(*) AS sessions,
               count(*) FILTER (WHERE session_pages = 1) AS bounces
        FROM pv WHERE n_rev = 1 GROUP BY 1 ORDER BY 2 DESC LIMIT 12
        """,
        window,
    )
    return {
        "window_days": days,
        "transitions": [dict(r) for r in transitions],
        "entries": [dict(r) for r in entries],
        "exits": [dict(r) for r in exits],
    }
