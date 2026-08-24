"""
Chat v2 reads/writes — conversations (league + direct), messages,
reactions, mentions, read state. See app/routers/chat.py and
migration 03417db98bb5.
"""


async def get_league_conversation_id(conn) -> int:
    return await conn.fetchval("SELECT id FROM conversations WHERE type = 'league'")


async def get_conversation_type(conn, conversation_id: int) -> str | None:
    return await conn.fetchval("SELECT type FROM conversations WHERE id = $1", conversation_id)


async def is_participant(conn, conversation_id: int, owner_id: int) -> bool:
    row = await conn.fetchrow(
        "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND owner_id = $2",
        conversation_id, owner_id,
    )
    return row is not None


async def get_message_owner_and_conversation(conn, message_id: int):
    """For permission checks (delete/react) — who sent it, and which
    conversation it's in, without fetching the whole message."""
    return await conn.fetchrow(
        "SELECT owner_id, conversation_id FROM messages WHERE id = $1", message_id
    )


async def list_conversation_participant_ids(conn, conversation_id: int) -> list[int]:
    rows = await conn.fetch(
        "SELECT owner_id FROM conversation_participants WHERE conversation_id = $1", conversation_id
    )
    return [r["owner_id"] for r in rows]


async def get_or_create_direct_conversation(conn, owner_a: int, owner_b: int) -> int:
    """Finds the existing 1:1 direct conversation between exactly these
    two owners, or creates one. Never duplicates — two owners only ever
    share one direct conversation."""
    existing = await conn.fetchval(
        """
        SELECT cp1.conversation_id
        FROM conversation_participants cp1
        JOIN conversation_participants cp2
            ON cp1.conversation_id = cp2.conversation_id AND cp2.owner_id = $2
        JOIN conversations c ON c.id = cp1.conversation_id
        WHERE cp1.owner_id = $1 AND c.type = 'direct'
        """,
        owner_a, owner_b,
    )
    if existing is not None:
        return existing

    conversation_id = await conn.fetchval("INSERT INTO conversations (type) VALUES ('direct') RETURNING id")
    await conn.execute(
        "INSERT INTO conversation_participants (conversation_id, owner_id) VALUES ($1, $2), ($1, $3)",
        conversation_id, owner_a, owner_b,
    )
    return conversation_id


async def list_conversations_for_owner(conn, owner_id: int):
    """Everything the conversation list needs in one shot: type, the
    other participant's name for a direct conversation, member count
    for the league conversation, the last message preview, and an
    unread count derived from last_read_message_id."""
    rows = await conn.fetch(
        """
        WITH mine AS (
            SELECT conversation_id, last_read_message_id
            FROM conversation_participants
            WHERE owner_id = $1
        ),
        last_message AS (
            SELECT DISTINCT ON (m.conversation_id)
                m.conversation_id, m.id, m.body, m.image_url, m.created_at, m.deleted_at, o.display_name AS owner_name
            FROM messages m
            JOIN owners o ON o.owner_id = m.owner_id
            ORDER BY m.conversation_id, m.created_at DESC
        ),
        unread AS (
            SELECT m.conversation_id, COUNT(*) AS unread_count
            FROM messages m
            JOIN mine ON mine.conversation_id = m.conversation_id
            WHERE m.deleted_at IS NULL
              AND m.owner_id != $1
              AND (mine.last_read_message_id IS NULL OR m.id > mine.last_read_message_id)
            GROUP BY m.conversation_id
        )
        SELECT
            c.id, c.type,
            lm.id AS last_message_id, lm.body AS last_message_body, lm.image_url AS last_message_image_url, lm.created_at AS last_message_at,
            lm.deleted_at AS last_message_deleted_at, lm.owner_name AS last_message_owner_name,
            COALESCE(u.unread_count, 0) AS unread_count,
            (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) AS member_count,
            other.owner_id AS other_owner_id, other.display_name AS other_owner_name
        FROM mine
        JOIN conversations c ON c.id = mine.conversation_id
        LEFT JOIN last_message lm ON lm.conversation_id = c.id
        LEFT JOIN unread u ON u.conversation_id = c.id
        LEFT JOIN conversation_participants other_cp
            ON other_cp.conversation_id = c.id AND other_cp.owner_id != $1 AND c.type = 'direct'
        LEFT JOIN owners other ON other.owner_id = other_cp.owner_id
        ORDER BY c.type = 'league' DESC, lm.created_at DESC NULLS LAST
        """,
        owner_id,
    )
    return rows


async def list_messages(conn, conversation_id: int, before_id: int | None, limit: int):
    """Newest-first page (before_id for pagination), returned in
    chronological order for display. Reply-to previews and reaction
    counts are batch-fetched separately by the caller (app/domain/chat.py)
    to avoid an N+1 query per message."""
    if before_id is not None:
        rows = await conn.fetch(
            """
            SELECT m.id, m.conversation_id, m.owner_id, o.display_name AS owner_name, o.chat_color AS owner_chat_color,
                   m.body, m.created_at, m.deleted_at, m.reply_to_id, m.image_url
            FROM messages m
            JOIN owners o ON o.owner_id = m.owner_id
            WHERE m.conversation_id = $1 AND m.id < $2
            ORDER BY m.id DESC
            LIMIT $3
            """,
            conversation_id, before_id, limit,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT m.id, m.conversation_id, m.owner_id, o.display_name AS owner_name, o.chat_color AS owner_chat_color,
                   m.body, m.created_at, m.deleted_at, m.reply_to_id, m.image_url
            FROM messages m
            JOIN owners o ON o.owner_id = m.owner_id
            WHERE m.conversation_id = $1
            ORDER BY m.id DESC
            LIMIT $2
            """,
            conversation_id, limit,
        )
    return list(reversed(rows))


async def get_messages_by_id(conn, message_ids: list[int]):
    if not message_ids:
        return []
    return await conn.fetch(
        """
        SELECT m.id, o.display_name AS owner_name, m.body, m.image_url, m.deleted_at
        FROM messages m JOIN owners o ON o.owner_id = m.owner_id
        WHERE m.id = ANY($1::int[])
        """,
        message_ids,
    )


async def get_reactions_for_messages(conn, message_ids: list[int], requesting_owner_id: int):
    if not message_ids:
        return []
    return await conn.fetch(
        """
        SELECT message_id, emoji, COUNT(*) AS count,
               bool_or(owner_id = $2) AS reacted_by_me
        FROM message_reactions
        WHERE message_id = ANY($1::int[])
        GROUP BY message_id, emoji
        """,
        message_ids, requesting_owner_id,
    )


async def get_mentions_for_messages(conn, message_ids: list[int]):
    if not message_ids:
        return []
    return await conn.fetch(
        "SELECT message_id, owner_id FROM message_mentions WHERE message_id = ANY($1::int[])",
        message_ids,
    )


async def insert_message(
    conn, conversation_id: int, owner_id: int, body: str, reply_to_id: int | None, image_url: str | None = None
):
    return await conn.fetchrow(
        """
        INSERT INTO messages (conversation_id, owner_id, body, reply_to_id, image_url)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, conversation_id, owner_id, body, created_at, deleted_at, reply_to_id, image_url
        """,
        conversation_id, owner_id, body, reply_to_id, image_url,
    )


async def insert_mentions(conn, message_id: int, owner_ids: list[int]):
    if not owner_ids:
        return
    await conn.executemany(
        "INSERT INTO message_mentions (message_id, owner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [(message_id, oid) for oid in owner_ids],
    )


async def mark_read(conn, conversation_id: int, owner_id: int, message_id: int):
    await conn.execute(
        """
        UPDATE conversation_participants
        SET last_read_message_id = $3
        WHERE conversation_id = $1 AND owner_id = $2
          AND (last_read_message_id IS NULL OR last_read_message_id < $3)
        """,
        conversation_id, owner_id, message_id,
    )


async def get_latest_message_id(conn, conversation_id: int) -> int | None:
    return await conn.fetchval(
        "SELECT MAX(id) FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL", conversation_id
    )


async def toggle_reaction(conn, message_id: int, owner_id: int, emoji: str) -> bool:
    """Returns True if the reaction was added, False if it was removed
    (toggle semantics — reacting again with the same emoji undoes it)."""
    deleted = await conn.fetchval(
        "DELETE FROM message_reactions WHERE message_id = $1 AND owner_id = $2 AND emoji = $3 RETURNING id",
        message_id, owner_id, emoji,
    )
    if deleted is not None:
        return False
    await conn.execute(
        "INSERT INTO message_reactions (message_id, owner_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        message_id, owner_id, emoji,
    )
    return True


async def soft_delete_message(conn, message_id: int):
    await conn.execute("UPDATE messages SET deleted_at = now() WHERE id = $1", message_id)


async def list_eligible_members(conn, active_season: int, exclude_owner_id: int):
    """Every owner with a team in the active season, minus the
    requesting owner — the pool for @mention autocomplete and "new
    message" search. Matches the same 12 real managers the league
    conversation was seeded with."""
    return await conn.fetch(
        """
        SELECT DISTINCT o.owner_id, o.display_name, t.team_name
        FROM owners o
        JOIN teams_by_season t ON t.owner_id = o.owner_id
        WHERE t.season = $1 AND o.owner_id != $2
        ORDER BY o.display_name
        """,
        active_season, exclude_owner_id,
    )
