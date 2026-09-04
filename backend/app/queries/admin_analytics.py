"""
Backing queries for the admin-only usage dashboard
(app/routers/admin.py's GET /admin/online, POST /admin/track-view,
GET /admin/usage). Site-owner visibility only — see
migrations/versions/2587a1c96f73_add_page_view_events_table.py's own
docstring for why this is owner_id-tied (not anonymous) but still
gated to a single admin reader, not exposed to the owners it's about.
"""
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


async def record_page_view(conn, owner_id: int, path: str) -> None:
    await conn.execute(
        "INSERT INTO page_view_events (owner_id, path) VALUES ($1, $2)", owner_id, path
    )


async def get_usage_summary(conn, days: int) -> dict:
    """Top paths by view count and distinct-owner count, plus a
    per-owner total, both over the trailing `days` window — "which
    pages/features get used, how often, by whom" in one read. A
    ~12-person league's whole view volume is trivial, so this is a
    plain aggregate query, not a pre-computed rollup table."""
    top_paths = await conn.fetch(
        """
        SELECT path, count(*) AS views, count(DISTINCT owner_id) AS unique_owners
        FROM page_view_events
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY path
        ORDER BY views DESC
        LIMIT 25
        """,
        str(days),
    )
    by_owner = await conn.fetch(
        """
        SELECT pve.owner_id, o.display_name, count(*) AS views
        FROM page_view_events pve
        JOIN owners o ON o.owner_id = pve.owner_id
        WHERE pve.created_at >= now() - ($1 || ' days')::interval
        GROUP BY pve.owner_id, o.display_name
        ORDER BY views DESC
        """,
        str(days),
    )
    total_views = await conn.fetchval(
        "SELECT count(*) FROM page_view_events WHERE created_at >= now() - ($1 || ' days')::interval", str(days)
    )
    return {
        "window_days": days,
        "total_views": total_views,
        "top_paths": [dict(r) for r in top_paths],
        "by_owner": [dict(r) for r in by_owner],
    }
