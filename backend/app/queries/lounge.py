"""
Lounge room reads and writes. See app/routers/lounge.py for how these
get assembled into API responses and that module's own docstring for
why Lounge is a standalone feature, not an extension of Watch Party.

Unlike watch_party_rooms, a lounge_rooms row has no membership table at
all — anyone who supplies the right password gets in, so there's
nothing to enumerate ahead of time. The only per-room state this module
manages beyond the room itself is the failed_attempts/locked_until
brute-force counter, since the join route is reachable with zero auth.
"""


async def create_room(conn, *, slug: str, name: str, password_hash: str, created_by_user_id: int) -> int:
    return await conn.fetchval(
        """
        INSERT INTO lounge_rooms (slug, name, password_hash, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """,
        slug,
        name,
        password_hash,
        created_by_user_id,
    )


async def get_room_by_slug(conn, slug: str):
    return await conn.fetchrow("SELECT * FROM lounge_rooms WHERE slug = $1", slug)


async def get_room(conn, room_id: int):
    return await conn.fetchrow("SELECT * FROM lounge_rooms WHERE id = $1", room_id)


async def list_rooms_for_creator(conn, created_by_user_id: int):
    return await conn.fetch(
        "SELECT * FROM lounge_rooms WHERE created_by_user_id = $1 ORDER BY created_at DESC",
        created_by_user_id,
    )


async def record_failed_join_attempt(conn, room_id: int, *, max_attempts: int, lockout_minutes: int) -> None:
    """One atomic UPDATE, not read-then-write, so concurrent wrong-
    password requests against the same room can't both slip past the
    threshold via a race."""
    await conn.execute(
        """
        UPDATE lounge_rooms
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
                WHEN failed_attempts + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
                ELSE locked_until
            END
        WHERE id = $1
        """,
        room_id,
        max_attempts,
        str(lockout_minutes),
    )


async def reset_failed_attempts(conn, room_id: int) -> None:
    await conn.execute(
        "UPDATE lounge_rooms SET failed_attempts = 0, locked_until = NULL WHERE id = $1",
        room_id,
    )


async def close_room(conn, room_id: int) -> None:
    await conn.execute(
        "UPDATE lounge_rooms SET closed_at = now() WHERE id = $1 AND closed_at IS NULL",
        room_id,
    )


async def is_invited(conn, room_id: int, user_id: int) -> bool:
    return bool(
        await conn.fetchval("SELECT 1 FROM lounge_room_invites WHERE room_id = $1 AND user_id = $2", room_id, user_id)
    )


async def add_invites(conn, room_id: int, user_ids: list[int], invited_by: int) -> list[int]:
    """Returns who was newly invited (already-invited friends aren't
    pushed again)."""
    rows = await conn.fetch(
        """
        INSERT INTO lounge_room_invites (room_id, user_id, invited_by)
        SELECT $1, unnest($2::int[]), $3
        ON CONFLICT (room_id, user_id) DO NOTHING
        RETURNING user_id
        """,
        room_id,
        user_ids,
        invited_by,
    )
    return [r["user_id"] for r in rows]


async def remove_invite(conn, room_id: int, user_id: int) -> None:
    await conn.execute("DELETE FROM lounge_room_invites WHERE room_id = $1 AND user_id = $2", room_id, user_id)


async def invited_for_rooms(conn, room_ids: list[int]):
    """Who each room's host invited, for "Your lounges"."""
    return await conn.fetch(
        """
        SELECT i.room_id, u.id AS user_id,
               COALESCE(o.display_name, u.display_name, u.username, 'Someone') AS name
        FROM lounge_room_invites i
        JOIN users u ON u.id = i.user_id
        LEFT JOIN LATERAL (
            SELECT ow.display_name FROM owner_users ou JOIN owners ow ON ow.owner_id = ou.owner_id
            WHERE ou.user_id = u.id ORDER BY ou.owner_id LIMIT 1
        ) o ON TRUE
        WHERE i.room_id = ANY($1::int[])
        ORDER BY i.created_at
        """,
        room_ids,
    )


async def invites_for_user(conn, user_id: int):
    """Open rooms friends invited you to, newest first."""
    return await conn.fetch(
        """
        SELECT r.id, r.slug, r.name, i.created_at AS invited_at,
               COALESCE(o.display_name, u.display_name, u.username, 'A friend') AS host_name
        FROM lounge_room_invites i
        JOIN lounge_rooms r ON r.id = i.room_id AND r.closed_at IS NULL
        JOIN users u ON u.id = r.created_by_user_id
        LEFT JOIN LATERAL (
            SELECT ow.display_name FROM owner_users ou JOIN owners ow ON ow.owner_id = ou.owner_id
            WHERE ou.user_id = u.id ORDER BY ou.owner_id LIMIT 1
        ) o ON TRUE
        WHERE i.user_id = $1
        ORDER BY i.created_at DESC
        """,
        user_id,
    )
