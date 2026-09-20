"""
Watch Party room/membership reads and writes. See
app/routers/watch_party.py for how these get assembled into API
responses and app/domain/matchup_context.py's own docstring for the
"eligible members" pattern this reuses rather than duplicates.

No membership row ever exists for an 'open' room — every active
league member is implicitly eligible for it, checked at request time
the same way chat's own list_eligible_members already is. This module
only ever writes watch_party_room_members for a 'private' room.

Phase 3: every room is linked 1:1 to a real chat conversation
(conversations.type = 'watch_party') so its text chat reuses the
existing chat stack — same tables, same WebSocket, same
MessageBubble/MessageComposer — instead of a second one. A private
room's invitees become conversation_participants immediately (they
were explicitly invited); the open room's implicit, computed-at-
request-time eligibility has no matching upfront participant list, so
those rows are added lazily, the moment someone actually joins (see
ensure_conversation_participant, called from the router once room
access is confirmed) rather than preemptively for every eligible
league member who may never open it.
"""
from app.queries import chat as chat_queries


async def get_open_room(conn, league_id: int):
    return await conn.fetchrow(
        "SELECT * FROM watch_party_rooms WHERE league_id = $1 AND kind = 'open'",
        league_id,
    )


async def _link_conversation(conn, room, owner_id: int):
    """Creates a watch_party conversation for a room row that doesn't
    have one yet and points the room at it. `owner_id` becomes that
    conversation's first participant — reasonable for the backfill case
    this exists for (get_or_create_open_room's self-heal): whoever
    happens to trigger it is a real, currently-active league member,
    same as anyone else who'd become a participant by actually opening
    the room (see ensure_conversation_participant)."""
    conversation_id = await chat_queries.create_conversation_for_league(
        conn, room["league_id"], "watch_party", [owner_id]
    )
    await conn.execute("UPDATE watch_party_rooms SET conversation_id = $1 WHERE id = $2", conversation_id, room["id"])
    return await conn.fetchrow("SELECT * FROM watch_party_rooms WHERE id = $1", room["id"])


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
        if room["conversation_id"] is None:
            # Self-healing backfill for a room created before Phase 3's
            # conversation_id column existed (confirmed against real
            # production data, not a hypothetical: this league's real
            # League Lounge row predates it) — every OTHER path into
            # this table (new leagues, private rooms) always sets it at
            # creation time going forward, so this branch only ever
            # matters for that one pre-existing row per league.
            room = await _link_conversation(conn, room, created_by_owner_id)
        return room
    # A genuinely simultaneous first-request race can create two
    # conversations here, one per racer, even though only one room row
    # survives the ON CONFLICT below — the losing conversation is
    # orphaned (never referenced by anything, harmless) rather than
    # reused. Not worth a transaction/advisory-lock for how rare "two
    # owners open League Lounge for the very first time in the same
    # instant" actually is.
    conversation_id = await chat_queries.create_conversation_for_league(
        conn, league_id, "watch_party", [created_by_owner_id]
    )
    await conn.execute(
        """
        INSERT INTO watch_party_rooms (league_id, name, kind, created_by_owner_id, conversation_id)
        VALUES ($1, 'League Lounge', 'open', $2, $3)
        ON CONFLICT (league_id) WHERE kind = 'open' DO NOTHING
        """,
        league_id, created_by_owner_id, conversation_id,
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
    # The creator is always a member of their own room even if they
    # didn't separately list themselves as an invite.
    all_owner_ids = {created_by_owner_id, *invited_owner_ids}
    # A private room's invite list IS its participant list — unlike the
    # open room, there's no separate "join later" moment to defer this
    # to, so every invitee becomes chat-authorized immediately.
    conversation_id = await chat_queries.create_conversation_for_league(
        conn, league_id, "watch_party", list(all_owner_ids)
    )
    room_id = await conn.fetchval(
        """
        INSERT INTO watch_party_rooms (league_id, name, kind, created_by_owner_id, conversation_id)
        VALUES ($1, $2, 'private', $3, $4)
        RETURNING id
        """,
        league_id, name, created_by_owner_id, conversation_id,
    )
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


async def ensure_conversation_participant(conn, conversation_id: int, owner_id: int) -> None:
    """Lazily grants chat access to a room's linked conversation the
    moment someone actually joins that room — see this module's own
    docstring for why the open room can't do this upfront the way a
    private room's invite list already does."""
    await conn.execute(
        "INSERT INTO conversation_participants (conversation_id, owner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        conversation_id, owner_id,
    )


async def list_room_members(conn, room_id: int):
    """Private-room-only — the open room has no membership rows to
    list (see this module's own docstring)."""
    return await conn.fetch(
        """
        SELECT m.owner_id, o.display_name
        FROM watch_party_room_members m
        JOIN owners o ON o.owner_id = m.owner_id
        WHERE m.room_id = $1
        ORDER BY o.display_name
        """,
        room_id,
    )


async def remove_private_room_member(conn, room_id: int, conversation_id: int, owner_id: int) -> None:
    """Revokes both the room membership row (blocks any future token/WS
    join — see _room_if_accessible) and the matching chat access (so a
    removed member can't keep posting in the room's conversation
    either). Doesn't forcibly disconnect an already-live LiveKit
    session — that would need a real call to LiveKit's own server API
    (RoomServiceClient.remove_participant), not just this app's own
    data; flagged as a known gap, not silently pretended away."""
    await conn.execute("DELETE FROM watch_party_room_members WHERE room_id = $1 AND owner_id = $2", room_id, owner_id)
    await conn.execute(
        "DELETE FROM conversation_participants WHERE conversation_id = $1 AND owner_id = $2", conversation_id, owner_id
    )
