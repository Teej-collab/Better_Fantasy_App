"""
Friends reads and writes (2026-10-26). See app/routers/friends.py.

Friends are between accounts (users), not league owners, so they work
across leagues and for people with no league at all. A person's name and
photo come from their owner record when they have one (the name and photo
their league sees), else the account's own display name or username.
"""

# Name and photo for a user. LATERAL picks one owner when a co-owned
# account somehow has several links.
_PERSON = """
    u.id AS user_id,
    u.username,
    COALESCE(o.display_name, u.display_name, u.username, 'Someone') AS name,
    o.logo_url AS photo_url
"""
_OWNER_JOIN = """
    LEFT JOIN LATERAL (
        SELECT ow.display_name, ow.logo_url
        FROM owner_users ou JOIN owners ow ON ow.owner_id = ou.owner_id
        WHERE ou.user_id = u.id
        ORDER BY ou.owner_id LIMIT 1
    ) o ON TRUE
"""

# Either side blocked the other (owner_blocks, the chat block) — those
# two never see each other here.
_BLOCKED = """
    EXISTS (
        SELECT 1 FROM owner_blocks b
        JOIN owner_users me_ou ON me_ou.user_id = $1
        JOIN owner_users them_ou ON them_ou.user_id = u.id
        WHERE (b.blocker_owner_id = me_ou.owner_id AND b.blocked_owner_id = them_ou.owner_id)
           OR (b.blocker_owner_id = them_ou.owner_id AND b.blocked_owner_id = me_ou.owner_id)
    )
"""


async def get_username(conn, user_id: int) -> str | None:
    return await conn.fetchval("SELECT username FROM users WHERE id = $1", user_id)


async def username_taken(conn, username: str, user_id: int) -> bool:
    return bool(
        await conn.fetchval(
            "SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2", username, user_id
        )
    )


async def set_username(conn, user_id: int, username: str | None) -> None:
    await conn.execute("UPDATE users SET username = $2 WHERE id = $1", user_id, username)


async def relationship(conn, user_id: int, other_id: int) -> str:
    """'friends', 'outgoing' (you asked), 'incoming' (they asked) or 'none'."""
    rows = await conn.fetch(
        """
        SELECT requester_id, status FROM friendships
        WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
        """,
        user_id,
        other_id,
    )
    if any(r["status"] == "accepted" for r in rows):
        return "friends"
    if any(r["requester_id"] == user_id for r in rows):
        return "outgoing"
    if rows:
        return "incoming"
    return "none"


async def is_blocked(conn, user_id: int, other_id: int) -> bool:
    return bool(await conn.fetchval(f"SELECT {_BLOCKED} FROM users u WHERE u.id = $2", user_id, other_id))


async def user_exists(conn, user_id: int) -> bool:
    return bool(await conn.fetchval("SELECT 1 FROM users WHERE id = $1", user_id))


async def request(conn, requester_id: int, addressee_id: int) -> None:
    await conn.execute(
        """
        INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)
        ON CONFLICT (requester_id, addressee_id) DO NOTHING
        """,
        requester_id,
        addressee_id,
    )


async def accept(conn, user_id: int, requester_id: int) -> bool:
    status = await conn.execute(
        """
        UPDATE friendships SET status = 'accepted', accepted_at = now()
        WHERE requester_id = $2 AND addressee_id = $1 AND status = 'pending'
        """,
        user_id,
        requester_id,
    )
    return status.split()[-1] != "0"


async def remove(conn, user_id: int, other_id: int) -> None:
    """Unfriend, decline a request or cancel your own — all the same row(s)."""
    await conn.execute(
        """
        DELETE FROM friendships
        WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
        """,
        user_id,
        other_id,
    )
    # Their invites to each other's Lounge rooms go with the friendship.
    await conn.execute(
        """
        DELETE FROM lounge_room_invites i USING lounge_rooms r
        WHERE i.room_id = r.id
          AND ((r.created_by_user_id = $1 AND i.user_id = $2) OR (r.created_by_user_id = $2 AND i.user_id = $1))
        """,
        user_id,
        other_id,
    )


async def list_all(conn, user_id: int):
    """Friends and pending requests both ways, each with the leagues you share."""
    return await conn.fetch(
        f"""
        WITH mine AS (
            SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS other_id,
                   bool_or(status = 'accepted') AS accepted,
                   bool_or(requester_id = $1) AS i_asked,
                   max(COALESCE(accepted_at, created_at)) AS since
            FROM friendships
            WHERE (requester_id = $1 OR addressee_id = $1) AND requester_id <> addressee_id
            GROUP BY 1
        )
        SELECT {_PERSON}, m.accepted, m.i_asked, m.since,
               ARRAY(
                   SELECT l.name FROM league_members a
                   JOIN league_members b ON b.league_id = a.league_id AND b.user_id = u.id
                   JOIN leagues l ON l.id = a.league_id
                   WHERE a.user_id = $1 ORDER BY l.name
               ) AS shared_leagues
        FROM mine m
        JOIN users u ON u.id = m.other_id
        {_OWNER_JOIN}
        WHERE NOT {_BLOCKED}
        ORDER BY m.accepted, lower(COALESCE(o.display_name, u.display_name, u.username, ''))
        """,
        user_id,
    )


async def search(conn, user_id: int, q: str, limit: int = 20):
    """By username only (starts with), so nobody can be found by a real
    name or email they didn't choose to share."""
    return await conn.fetch(
        f"""
        SELECT {_PERSON}
        FROM users u
        {_OWNER_JOIN}
        WHERE u.username IS NOT NULL AND lower(u.username) LIKE lower($2) || '%'
          AND u.id <> $1 AND NOT {_BLOCKED}
        ORDER BY length(u.username), lower(u.username)
        LIMIT $3
        """,
        user_id,
        q.replace("\\", "").replace("%", "").replace("_", "\\_"),
        limit,
    )


async def played_with(conn, user_id: int, limit: int = 60):
    """Everyone with an account in a league you're in (or were), minus
    people you're already friends with or have a request with."""
    return await conn.fetch(
        f"""
        SELECT {_PERSON},
               array_agg(DISTINCT l.name ORDER BY l.name) AS shared_leagues
        FROM league_members a
        JOIN league_members b ON b.league_id = a.league_id AND b.user_id <> a.user_id
        JOIN leagues l ON l.id = a.league_id
        JOIN users u ON u.id = b.user_id
        {_OWNER_JOIN}
        WHERE a.user_id = $1
          AND NOT EXISTS (
              SELECT 1 FROM friendships f
              WHERE (f.requester_id = $1 AND f.addressee_id = u.id) OR (f.requester_id = u.id AND f.addressee_id = $1)
          )
          AND NOT {_BLOCKED}
        GROUP BY u.id, u.username, o.display_name, o.logo_url
        ORDER BY lower(COALESCE(o.display_name, u.display_name, u.username, ''))
        LIMIT $2
        """,
        user_id,
        limit,
    )


async def friend_ids(conn, user_id: int, among: list[int]) -> set[int]:
    rows = await conn.fetch(
        """
        SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS other_id
        FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = $1 AND addressee_id = ANY($2::int[])) OR (addressee_id = $1 AND requester_id = ANY($2::int[])))
        """,
        user_id,
        among,
    )
    return {r["other_id"] for r in rows}


async def person(conn, user_id: int):
    return await conn.fetchrow(f"SELECT {_PERSON} FROM users u {_OWNER_JOIN} WHERE u.id = $1", user_id)


async def owner_id_for_user(conn, user_id: int) -> int | None:
    return await conn.fetchval("SELECT owner_id FROM owner_users WHERE user_id = $1 ORDER BY owner_id LIMIT 1", user_id)
