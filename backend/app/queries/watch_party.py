"""
Watch Party room/membership reads and writes. See
app/routers/watch_party.py for how these get assembled into API
responses and app/domain/matchup_context.py's own docstring for the
"eligible members" pattern this reuses rather than duplicates.

No membership row ever exists for an 'open' room — every active
league member is implicitly eligible for it, checked at request time
the same way chat's own list_eligible_members already is. This module
only ever writes watch_party_room_members for a 'private' room.
"""


async def get_open_room(conn, league_id: int):
    return await conn.fetchrow(
        "SELECT * FROM watch_party_rooms WHERE league_id = $1 AND kind = 'open'",
        league_id,
    )


async def get_or_create_open_room(conn, league_id: int, created_by_owner_id: int):
    """Lazily created on first request for a league that doesn't have
    one yet — same lazy-create-on-write shape as owner_preferences.
    ON CONFLICT targets the partial unique index
    (watch_party_rooms_one_open_per_league) so a race between two
    owners' simultaneous first request is safe: whichever insert loses
    is a no-op, and the SELECT below always finds the real row either
    way."""
    room = await get_open_room(conn, league_id)
    if room is not None:
        return room
    await conn.execute(
        """
        INSERT INTO watch_party_rooms (league_id, name, kind, created_by_owner_id)
        VALUES ($1, 'League Lounge', 'open', $2)
        ON CONFLICT (league_id) WHERE kind = 'open' DO NOTHING
        """,
        league_id, created_by_owner_id,
    )
    return await get_open_room(conn, league_id)


async def list_private_rooms_for_owner(conn, league_id: int, owner_id: int):
    """Rooms the owner created or was invited to — the creator is
    always also a member row (see create_private_room), so this is one
    membership join, not "created OR member"."""
    return await conn.fetch(
        """
        SELECT r.*,
               (SELECT COUNT(*) FROM watch_party_room_members wm WHERE wm.room_id = r.id) AS member_count
        FROM watch_party_rooms r
        JOIN watch_party_room_members m ON m.room_id = r.id AND m.owner_id = $2
        WHERE r.league_id = $1 AND r.kind = 'private' AND r.closed_at IS NULL
        ORDER BY r.created_at DESC
        """,
        league_id, owner_id,
    )


async def create_private_room(conn, league_id: int, name: str, created_by_owner_id: int, invited_owner_ids: list[int]) -> int:
    room_id = await conn.fetchval(
        """
        INSERT INTO watch_party_rooms (league_id, name, kind, created_by_owner_id)
        VALUES ($1, $2, 'private', $3)
        RETURNING id
        """,
        league_id, name, created_by_owner_id,
    )
    # The creator is always a member of their own room even if they
    # didn't separately list themselves as an invite.
    all_owner_ids = {created_by_owner_id, *invited_owner_ids}
    await conn.executemany(
        """
        INSERT INTO watch_party_room_members (room_id, owner_id, invited_by_owner_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        """,
        [(room_id, owner_id, created_by_owner_id) for owner_id in all_owner_ids],
    )
    return room_id


async def get_room(conn, room_id: int):
    return await conn.fetchrow("SELECT * FROM watch_party_rooms WHERE id = $1", room_id)


async def is_private_room_member(conn, room_id: int, owner_id: int) -> bool:
    row = await conn.fetchval(
        "SELECT 1 FROM watch_party_room_members WHERE room_id = $1 AND owner_id = $2",
        room_id, owner_id,
    )
    return row is not None
