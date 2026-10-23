"""
Backing queries for the admin dashboard's event system
(app/routers/admin.py's POST /admin/track, GET /admin/navigation) and
live presence (GET /admin/online). Site-owner visibility only — see
migrations/versions/c8ca9b06b451_generalize_page_view_events_into_.py's
own docstring for the analytics_events schema this reads/writes, and
app/analytics/taxonomy.py for the event names/metadata shapes it's
validated against before ever reaching record_event.
"""
import json

from app.analytics import taxonomy
from app.chat.manager import manager as chat_manager


async def list_online_owners(conn) -> list[dict]:
    """Username only, per the owner's own explicit request when this
    was designed — no email, no espn_member_id, nothing else. Backed
    by chat_manager's connection registry (in-process, not a DB read)
    rather than a DB "last seen" column, so this is live, not a stale
    snapshot."""
    owner_ids = chat_manager.connected_owner_ids()
    if not owner_ids:
        return []
    rows = await conn.fetch(
        "SELECT owner_id, display_name FROM owners WHERE owner_id = ANY($1::int[]) ORDER BY display_name",
        owner_ids,
    )
    return [dict(r) for r in rows]


async def record_event(
    conn,
    owner_id: int,
    session_id: str,
    event_name: str,
    event_type: str,
    route: str | None,
    league_id: int | None,
    metadata: dict,
    device_type: str | None,
    platform: str | None,
) -> None:
    """owner_id/session_id are always server-derived (owner_id from
    the session, session_id from the caller's own validated request
    body) — never trusted as someone else's, see POST /admin/track's
    own docstring. metadata has already passed app/analytics/
    taxonomy.py's validate_event by the time this runs."""
    await conn.execute(
        """
        INSERT INTO analytics_events
            (owner_id, session_id, event_name, event_type, route, league_id, metadata, device_type, platform)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        """,
        owner_id, session_id, event_name, event_type, route, league_id, json.dumps(metadata), device_type, platform,
    )


async def get_navigation_heatmap(conn, days: int) -> dict:
    """Every page_view event, grouped by route — page views, distinct
    sessions, and distinct owners over the trailing `days` window.
    Distinct-session count is what actually makes this a "how much
    real traffic" signal rather than "how many times did someone leave
    a tab open on this route" (a single long-lived session refreshing/
    revisiting the same route repeatedly still only ever accrues real
    page_view rows on real navigations — see frontend/src/lib/
    analyticsEvents.ts's trackPageView, called once per route change,
    not once per render)."""
    rows = await conn.fetch(
        """
        SELECT event_name, count(*) AS views, count(DISTINCT session_id) AS sessions,
               count(DISTINCT owner_id) AS unique_owners
        FROM analytics_events
        WHERE event_type = 'page_view' AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY event_name
        ORDER BY views DESC
        """,
        str(days),
    )
    total_views = await conn.fetchval(
        "SELECT count(*) FROM analytics_events WHERE event_type = 'page_view' AND created_at >= now() - ($1 || ' days')::interval",
        str(days),
    )
    return {
        "window_days": days,
        "total_views": total_views,
        "routes": [dict(r) for r in rows],
    }


async def get_feature_usage(conn, days: int) -> list[dict]:
    """Same shape as the navigation heat map above, but for `feature`
    events (app/analytics/taxonomy.py's FEATURE_EVENTS) — a much
    smaller, deliberately curated list, so this is naturally a short
    table rather than needing its own pagination."""
    rows = await conn.fetch(
        """
        SELECT event_name, count(*) AS uses, count(DISTINCT owner_id) AS unique_owners
        FROM analytics_events
        WHERE event_type = 'feature' AND event_name <> ALL($2::text[])
          AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY event_name
        ORDER BY uses DESC
        """,
        str(days),
        [taxonomy.CRASH_EVENT_NAME, taxonomy.TAP_EVENT_NAME],
    )
    return [dict(r) for r in rows]


async def get_tap_usage(conn, days: int) -> dict:
    """Admin > Taps (2026-10-22): what gets tapped and by whom. `targets`:
    each tap target with its taps, distinct people, and who (most taps
    first). `people`: each person's taps and screens, most used first,
    so you can see what each member actually uses."""
    window = str(days)
    by_person = await conn.fetch(
        """
        SELECT e.metadata->>'target' AS target, e.owner_id, o.display_name, count(*) AS taps,
               max(e.created_at) AS last_at
        FROM analytics_events e JOIN owners o ON o.owner_id = e.owner_id
        WHERE e.event_name = $2 AND e.created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1, 2, 3
        """,
        window, taxonomy.TAP_EVENT_NAME,
    )
    screens = await conn.fetch(
        """
        SELECT e.owner_id, o.display_name, e.event_name AS screen, count(*) AS views
        FROM analytics_events e JOIN owners o ON o.owner_id = e.owner_id
        WHERE e.event_type = 'page_view' AND e.created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1, 2, 3
        """,
        window,
    )
    targets: dict[str, dict] = {}
    people: dict[int, dict] = {}

    def person(owner_id: int, name: str) -> dict:
        return people.setdefault(owner_id, {"owner_id": owner_id, "display_name": name, "taps": 0, "views": 0, "top_taps": [], "top_screens": []})

    for r in by_person:
        t = targets.setdefault(r["target"], {"target": r["target"], "taps": 0, "people": []})
        t["taps"] += r["taps"]
        t["people"].append({"owner_id": r["owner_id"], "display_name": r["display_name"], "taps": r["taps"], "last_at": r["last_at"]})
        p = person(r["owner_id"], r["display_name"])
        p["taps"] += r["taps"]
        p["top_taps"].append({"target": r["target"], "taps": r["taps"]})
    for r in screens:
        p = person(r["owner_id"], r["display_name"])
        p["views"] += r["views"]
        p["top_screens"].append({"screen": r["screen"], "views": r["views"]})

    for t in targets.values():
        t["people"].sort(key=lambda x: -x["taps"])
        t["unique_people"] = len(t["people"])
    for p in people.values():
        p["top_taps"] = sorted(p["top_taps"], key=lambda x: -x["taps"])[:8]
        p["top_screens"] = sorted(p["top_screens"], key=lambda x: -x["views"])[:8]
    return {
        "window_days": days,
        "total_taps": sum(t["taps"] for t in targets.values()),
        "targets": sorted(targets.values(), key=lambda t: -t["taps"]),
        "people": sorted(people.values(), key=lambda p: -(p["taps"] + p["views"])),
    }


async def get_crash_reports(conn, days: int, limit: int = 50) -> dict:
    """App crashes (taxonomy.CRASH_EVENT_NAME) over the trailing `days`
    window: totals, which pages they happen on, which OS/screen sizes,
    and the most recent individual reports with who hit them."""
    window = str(days)
    totals = await conn.fetchrow(
        """
        SELECT count(*) AS crashes, count(DISTINCT owner_id) AS affected_owners
        FROM analytics_events
        WHERE event_name = $2 AND created_at >= now() - ($1 || ' days')::interval
        """,
        window, taxonomy.CRASH_EVENT_NAME,
    )
    by_route = await conn.fetch(
        """
        SELECT coalesce(route, 'unknown') AS route, count(*) AS crashes,
               count(DISTINCT owner_id) AS affected_owners
        FROM analytics_events
        WHERE event_name = $2 AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1
        ORDER BY crashes DESC
        LIMIT 25
        """,
        window, taxonomy.CRASH_EVENT_NAME,
    )
    by_device = await conn.fetch(
        """
        SELECT coalesce(metadata->>'os', 'unknown') AS os,
               coalesce(metadata->>'screen', 'unknown') AS screen,
               count(*) AS crashes, count(DISTINCT owner_id) AS affected_owners
        FROM analytics_events
        WHERE event_name = $2 AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1, 2
        ORDER BY crashes DESC
        LIMIT 25
        """,
        window, taxonomy.CRASH_EVENT_NAME,
    )
    recent = await conn.fetch(
        """
        SELECT e.created_at, e.route, e.platform, e.metadata, o.display_name
        FROM analytics_events e
        LEFT JOIN owners o ON o.owner_id = e.owner_id
        WHERE e.event_name = $2 AND e.created_at >= now() - ($1 || ' days')::interval
        ORDER BY e.created_at DESC
        LIMIT $3
        """,
        window, taxonomy.CRASH_EVENT_NAME, limit,
    )
    return {
        "window_days": days,
        "crashes": totals["crashes"],
        "affected_owners": totals["affected_owners"],
        "by_route": [dict(r) for r in by_route],
        "by_device": [dict(r) for r in by_device],
        "recent": [
            {**dict(r), "metadata": json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"]}
            for r in recent
        ],
    }
