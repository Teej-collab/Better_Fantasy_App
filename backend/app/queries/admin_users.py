"""
Backing queries for the admin Users section (app/routers/admin.py's
GET /admin/users, GET /admin/users/{owner_id}). Every real account —
not just league members — since a self-serve signup with no league
yet is exactly one of the states the owner wants visibility into (see
STATUS_FILTERS' "no_league").

No email_verified/verified filter here on purpose: this app has never
had email verification as a concept (checked the schema before writing
this — users has no such column), so a "Verified/Unverified" filter
would be fabricated. Same discipline for "last active": derived from a
real analytics_events row, never a guess.
"""
ACTIVE_WINDOW_DAYS = 7

STATUS_FILTERS = {"all", "active", "inactive", "new", "commissioner", "multiple_leagues", "no_league"}

_BASE_SELECT = """
    SELECT u.id AS user_id, o.owner_id, COALESCE(o.display_name, u.display_name) AS display_name,
           u.email, u.created_at, u.is_admin,
           (SELECT count(*) FROM league_members lm WHERE lm.user_id = u.id) AS league_count,
           EXISTS(
               SELECT 1 FROM league_members lm WHERE lm.user_id = u.id AND lm.role = 'commissioner'
           ) AS is_commissioner_anywhere,
           (SELECT max(ae.created_at) FROM analytics_events ae WHERE ae.owner_id = o.owner_id) AS last_active
    FROM users u
    LEFT JOIN owners o ON o.user_id = u.id
"""


async def set_is_admin(conn, user_id: int, is_admin: bool) -> dict | None:
    """Grants or revokes independent admin-dashboard access (see
    app/auth/league_context.py's is_site_admin) — deliberately separate
    from league role: a real commissioner isn't necessarily an admin,
    and an admin isn't necessarily a commissioner of anything. Returns
    the updated user detail row, or None if user_id doesn't exist."""
    updated = await conn.fetchval("UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id", is_admin, user_id)
    if updated is None:
        return None
    return await get_user_detail(conn, user_id)


async def list_users(conn, search: str | None, status: str, limit: int, offset: int) -> dict:
    where = ["TRUE"]
    params: list = []
    if search:
        params.append(f"%{search}%")
        idx = len(params)
        where.append(
            f"(COALESCE(o.display_name, u.display_name) ILIKE ${idx} OR u.email ILIKE ${idx} OR u.id::text = ${idx + 1})"
        )
        params.append(search)
    if status == "new":
        where.append(f"u.created_at >= now() - interval '{ACTIVE_WINDOW_DAYS} days'")
    elif status == "active":
        where.append(
            f"(SELECT max(ae.created_at) FROM analytics_events ae WHERE ae.owner_id = o.owner_id) "
            f">= now() - interval '{ACTIVE_WINDOW_DAYS} days'"
        )
    elif status == "inactive":
        where.append(
            f"COALESCE((SELECT max(ae.created_at) FROM analytics_events ae WHERE ae.owner_id = o.owner_id), "
            f"'-infinity') < now() - interval '{ACTIVE_WINDOW_DAYS} days'"
        )
    elif status == "commissioner":
        where.append("EXISTS(SELECT 1 FROM league_members lm WHERE lm.user_id = u.id AND lm.role = 'commissioner')")
    elif status == "multiple_leagues":
        where.append("(SELECT count(*) FROM league_members lm WHERE lm.user_id = u.id) > 1")
    elif status == "no_league":
        where.append("(SELECT count(*) FROM league_members lm WHERE lm.user_id = u.id) = 0")

    where_sql = " AND ".join(where)
    total = await conn.fetchval(f"SELECT count(*) FROM users u LEFT JOIN owners o ON o.user_id = u.id WHERE {where_sql}", *params)

    params.append(limit)
    params.append(offset)
    rows = await conn.fetch(
        f"{_BASE_SELECT} WHERE {where_sql} ORDER BY u.created_at DESC LIMIT ${len(params) - 1} OFFSET ${len(params)}",
        *params,
    )
    return {"total": total, "users": [dict(r) for r in rows]}


async def get_user_detail(conn, user_id: int) -> dict | None:
    row = await conn.fetchrow(f"{_BASE_SELECT} WHERE u.id = $1", user_id)
    if row is None:
        return None
    user = dict(row)

    memberships = await conn.fetch(
        """
        SELECT lm.league_id, l.name AS league_name, lm.role, lm.joined_at
        FROM league_members lm JOIN leagues l ON l.id = lm.league_id
        WHERE lm.user_id = $1 ORDER BY lm.joined_at ASC
        """,
        user_id,
    )
    user["leagues"] = [dict(r) for r in memberships]

    if user["owner_id"] is not None:
        timeline = await conn.fetch(
            """
            SELECT event_name, event_type, route, metadata, device_type, platform, created_at
            FROM analytics_events WHERE owner_id = $1
            ORDER BY created_at DESC LIMIT 50
            """,
            user["owner_id"],
        )
        user["recent_activity"] = [dict(r) for r in timeline]
    else:
        user["recent_activity"] = []

    return user
