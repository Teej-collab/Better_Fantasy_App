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
