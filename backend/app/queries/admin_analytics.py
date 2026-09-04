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
        WHERE event_type = 'feature' AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY event_name
        ORDER BY uses DESC
        """,
        str(days),
    )
    return [dict(r) for r in rows]
