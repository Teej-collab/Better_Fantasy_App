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
    LEFT JOIN owner_users ou ON ou.user_id = u.id
    LEFT JOIN owners o ON o.owner_id = ou.owner_id
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
    total = await conn.fetchval(
        f"SELECT count(*) FROM users u "
        f"LEFT JOIN owner_users ou ON ou.user_id = u.id LEFT JOIN owners o ON o.owner_id = ou.owner_id "
        f"WHERE {where_sql}",
        *params,
    )

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

    user["delete_blockers"] = await get_deletion_blockers(conn, user_id)
    return user


async def get_deletion_blockers(conn, user_id: int) -> list[str]:
    """Every reason this account can't be safely hard-deleted — an
    empty list means DELETE /admin/users/{user_id} is safe to call.
    Checked directly against every real FK to users(id) in this schema
    (owner_users.user_id, league_members.user_id, leagues.created_by_user_id,
    league_polls.created_by_user_id, poll_votes.user_id,
    feedback.user_id — audited by grepping every migration for
    "REFERENCES users") rather than trusting a cascade: an owner link
    in particular fans out into draft picks, chug scores, keeper
    selections, chat messages and more, all keyed by owner_id, none of
    which a users-table DELETE would ever touch or warn about on its
    own. This is deliberately narrow — a real member should be
    unlinked/deactivated by hand, never hard-deleted through this
    endpoint; it exists for abandoned/duplicate signups (a stray OAuth
    retry, a mistyped-email account) that never became anything real."""
    blockers = []
    if await conn.fetchval("SELECT 1 FROM owner_users WHERE user_id = $1", user_id):
        blockers.append("Has a linked owner (real historical data)")
    if await conn.fetchval("SELECT 1 FROM league_members WHERE user_id = $1", user_id):
        blockers.append("Is a member of at least one league")
    if await conn.fetchval("SELECT 1 FROM leagues WHERE created_by_user_id = $1", user_id):
        blockers.append("Created a league")
    if await conn.fetchval("SELECT 1 FROM league_polls WHERE created_by_user_id = $1", user_id):
        blockers.append("Created a poll")
    if await conn.fetchval("SELECT 1 FROM poll_votes WHERE user_id = $1", user_id):
        blockers.append("Voted in a poll")
    if await conn.fetchval("SELECT 1 FROM feedback WHERE user_id = $1", user_id):
        blockers.append("Submitted feedback")
    return blockers


async def delete_user(conn, user_id: int) -> bool | list[str]:
    """Hard-deletes a user row with zero linked data. Re-validates via
    get_deletion_blockers itself (never trusts a caller who already
    checked) — returns that same non-empty blocker list if it's not
    actually safe, or False if the user doesn't exist, so the router
    can turn either into a clean 409/404 rather than a raw delete
    happening on stale information."""
    blockers = await get_deletion_blockers(conn, user_id)
    if blockers:
        return blockers
    result = await conn.execute("DELETE FROM users WHERE id = $1", user_id)
    return result != "DELETE 0"
