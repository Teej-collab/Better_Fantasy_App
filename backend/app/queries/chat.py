"""
Chat v2 reads/writes — conversations (league + direct), messages,
reactions, mentions, read state. See app/routers/chat.py and
migration 03417db98bb5.
"""


async def get_league_conversation_id(conn, league_id: int) -> int | None:
    return await conn.fetchval(
        "SELECT id FROM conversations WHERE type = 'league' AND league_id = $1", league_id
    )


async def get_conversation_type(conn, conversation_id: int) -> str | None:
    return await conn.fetchval("SELECT type FROM conversations WHERE id = $1", conversation_id)


async def get_conversation_type_and_league(conn, conversation_id: int):
    """Both fields a single query needs to decide "is this a
    commish_corner conversation, and if so whose league" — used by the
    WS message handler's posting-restriction check."""
    row = await conn.fetchrow(
        "SELECT type, league_id FROM conversations WHERE id = $1", conversation_id
    )
    return dict(row) if row else None


async def is_owner_commissioner_of_league(conn, owner_id: int, league_id: int) -> bool:
    """Chat is owner_id-keyed; league membership/role is user_id-keyed
    (league_members) — same owners.user_id join leagues.py's own
    membership queries already use to reconcile the two identities."""
    row = await conn.fetchrow(
        """
        SELECT 1 FROM owners o
        JOIN league_members lm ON lm.user_id = o.user_id
        WHERE o.owner_id = $1 AND lm.league_id = $2 AND lm.role = 'commissioner'
        """,
        owner_id, league_id,
    )
    return row is not None


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


async def list_conversation_preview_avatars(conn, conversation_id: int, limit: int = 3):
    """A handful of participants (deterministic order — by owner_id) for
    the conversation list's group-avatar-cluster on the league and
    commish_corner rows, which have no single "other person" the way a
    direct conversation does."""
    rows = await conn.fetch(
        """
        SELECT o.owner_id, o.display_name, o.chat_color, o.logo_url
        FROM conversation_participants cp
        JOIN owners o ON o.owner_id = cp.owner_id
        WHERE cp.conversation_id = $1
        ORDER BY o.owner_id
        LIMIT $2
        """,
        conversation_id, limit,
    )
    return [dict(r) for r in rows]


async def list_all_conversation_participants(conn, conversation_id: int):
    """The full roster for a conversation's "who's in this chat" info
    screen (unlike list_conversation_preview_avatars above, no LIMIT —
    that one is for the conversation list's small avatar cluster,
    this one is the real membership list). Ordered by display name
    rather than owner_id — a name-sorted roster reads naturally,
    matching how iMessage's own group-info screen presents members."""
    rows = await conn.fetch(
        """
        SELECT o.owner_id, o.display_name, o.chat_color, o.logo_url
        FROM conversation_participants cp
        JOIN owners o ON o.owner_id = cp.owner_id
        WHERE cp.conversation_id = $1
        ORDER BY o.display_name
        """,
        conversation_id,
    )
    return [dict(r) for r in rows]


async def create_conversation_for_league(conn, league_id: int, conv_type: str, owner_ids: list[int]) -> int:
    """The app-layer counterpart to migration e47b2a91c5d8's own one-time
    backfill SQL — used going forward whenever a new league is created
    (leagues.py's create_league seeds both a 'league' and a
    'commish_corner' conversation this way)."""
    conversation_id = await conn.fetchval(
        "INSERT INTO conversations (type, league_id) VALUES ($1, $2) RETURNING id",
        conv_type, league_id,
    )
    if owner_ids:
        await conn.executemany(
            "INSERT INTO conversation_participants (conversation_id, owner_id) VALUES ($1, $2)",
            [(conversation_id, oid) for oid in owner_ids],
        )
    return conversation_id


async def add_owner_to_league_conversations(conn, league_id: int, owner_id: int) -> None:
    """Joins an owner into every 'league'/'commish_corner' conversation
    for this league — called wherever an owner_id first gets
    established within a league (create_league for the creator, the
    self-serve and commissioner-invoked team-creation routes for
    everyone else), since chat participancy is owner_id-scoped and a
    bare league_members row alone can't be a chat participant. Safe to
    call more than once (ON CONFLICT DO NOTHING — conversation_participants'
    own primary key is (conversation_id, owner_id))."""
    await conn.execute(
        """
        INSERT INTO conversation_participants (conversation_id, owner_id)
        SELECT c.id, $2 FROM conversations c
        WHERE c.league_id = $1 AND c.type IN ('league', 'commish_corner')
        ON CONFLICT DO NOTHING
        """,
        league_id, owner_id,
    )


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


async def list_conversations_for_owner(conn, owner_id: int, league_id: int):
    """Everything the conversation list needs in one shot: type, the
    other participant's name for a direct conversation, member count
    for the league conversation, the last message preview, and an
    unread count derived from last_read_message_id.

    Scoped to the caller's active league for `league`/`commish_corner`
    conversations (each league gets its own, per migration
    e47b2a91c5d8) — but never for `direct` conversations, which are
    DMs between two owners regardless of which league(s) they happen
    to share, and must keep showing in every league they're active in."""
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
        last_reaction AS (
            SELECT DISTINCT ON (m.conversation_id)
                m.conversation_id, r.emoji, r.created_at, r.owner_id AS reactor_owner_id,
                ro.display_name AS reactor_name, m.body AS reacted_message_body
            FROM message_reactions r
            JOIN messages m ON m.id = r.message_id
            JOIN owners ro ON ro.owner_id = r.owner_id
            ORDER BY m.conversation_id, r.created_at DESC
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
            c.id, c.type, c.league_id,
            lm.id AS last_message_id, lm.body AS last_message_body, lm.image_url AS last_message_image_url, lm.created_at AS last_message_at,
            lm.deleted_at AS last_message_deleted_at, lm.owner_name AS last_message_owner_name,
            COALESCE(u.unread_count, 0) AS unread_count,
            (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) AS member_count,
            other.owner_id AS other_owner_id, other.display_name AS other_owner_name,
            other.chat_color AS other_owner_chat_color, other.logo_url AS other_owner_logo_url,
            -- Only exposed if the OTHER owner has Read Receipts on —
            -- their own preference gates whether their read state is
            -- visible to anyone, same as the live "read" WS broadcast
            -- (app/routers/chat.py's mark_conversation_read) already
            -- only fires when the reader's own preference allows it.
            CASE WHEN COALESCE(other_prefs.read_receipts_enabled, true)
                 THEN other_cp.last_read_message_id END AS other_last_read_message_id,
            lr.emoji AS last_reaction_emoji, lr.created_at AS last_reaction_at,
            lr.reactor_owner_id AS last_reaction_owner_id, lr.reactor_name AS last_reaction_owner_name,
            lr.reacted_message_body AS last_reaction_message_body
        FROM mine
        JOIN conversations c ON c.id = mine.conversation_id
        LEFT JOIN last_message lm ON lm.conversation_id = c.id
        LEFT JOIN last_reaction lr ON lr.conversation_id = c.id
        LEFT JOIN unread u ON u.conversation_id = c.id
        LEFT JOIN conversation_participants other_cp
            ON other_cp.conversation_id = c.id AND other_cp.owner_id != $1 AND c.type = 'direct'
        LEFT JOIN owners other ON other.owner_id = other_cp.owner_id
        LEFT JOIN owner_preferences other_prefs ON other_prefs.owner_id = other_cp.owner_id
        WHERE c.type = 'direct' OR c.league_id = $2
        ORDER BY
            CASE c.type WHEN 'commish_corner' THEN 0 WHEN 'league' THEN 1 ELSE 2 END,
            lm.created_at DESC NULLS LAST
        """,
        owner_id,
        league_id,
    )
    return rows


async def list_messages(conn, conversation_id: int, before_id: int | None, limit: int):
    """Newest-first page (before_id for pagination), returned in
    chronological order for display. Reply-to previews and reaction
    counts are batch-fetched separately by the caller (app/domain/chat.py)
    to avoid an N+1 query per message.

    Deleted messages are excluded outright (m.deleted_at IS NULL) —
    they shouldn't keep showing up in the thread at all, not even as a
    "This message was deleted." placeholder. A REPLY to a deleted
    message still shows that placeholder in its own reply-to preview
    (chat_domain.py's reply_previews, built from a separate by-ID
    lookup that isn't filtered this way) — useful context on the
    message that's still visible, not the deleted message reappearing
    in the main thread."""
    if before_id is not None:
        rows = await conn.fetch(
            """
            SELECT m.id, m.conversation_id, m.owner_id, o.display_name AS owner_name, o.chat_color AS owner_chat_color,
                   o.logo_url AS owner_logo_url,
                   m.body, m.created_at, m.deleted_at, m.reply_to_id, m.image_url, m.title
            FROM messages m
            JOIN owners o ON o.owner_id = m.owner_id
            WHERE m.conversation_id = $1 AND m.id < $2 AND m.deleted_at IS NULL
            ORDER BY m.id DESC
            LIMIT $3
            """,
            conversation_id, before_id, limit,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT m.id, m.conversation_id, m.owner_id, o.display_name AS owner_name, o.chat_color AS owner_chat_color,
                   o.logo_url AS owner_logo_url,
                   m.body, m.created_at, m.deleted_at, m.reply_to_id, m.image_url, m.title
            FROM messages m
            JOIN owners o ON o.owner_id = m.owner_id
            WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
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
        SELECT r.message_id, r.emoji, COUNT(*) AS count,
               bool_or(r.owner_id = $2) AS reacted_by_me,
               array_agg(o.display_name ORDER BY o.display_name) AS reactor_names
        FROM message_reactions r
        JOIN owners o ON o.owner_id = r.owner_id
        WHERE r.message_id = ANY($1::int[])
        GROUP BY r.message_id, r.emoji
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
    conn,
    conversation_id: int,
    owner_id: int,
    body: str,
    reply_to_id: int | None,
    image_url: str | None = None,
    title: str | None = None,
):
    # title is only ever non-NULL for a commish_corner announcement
    # (app/routers/chat.py's WS handler is the sole caller that ever
    # passes it) — every other conversation type leaves it NULL, same
    # "column exists, most rows don't use it" shape as image_url.
    return await conn.fetchrow(
        """
        INSERT INTO messages (conversation_id, owner_id, body, reply_to_id, image_url, title)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, conversation_id, owner_id, body, created_at, deleted_at, reply_to_id, image_url, title
        """,
        conversation_id, owner_id, body, reply_to_id, image_url, title,
    )


async def insert_mentions(conn, message_id: int, owner_ids: list[int]):
    if not owner_ids:
        return
    await conn.executemany(
        "INSERT INTO message_mentions (message_id, owner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [(message_id, oid) for oid in owner_ids],
    )


async def get_participants_read_state(conn, conversation_id: int, exclude_owner_id: int):
    """One row per other participant with read receipts on, their
    display name, and how far they've read (conversation_participants'
    last_read_message_id) — the same per-owner data 1:1 DMs already
    expose (see other_last_read_message_id above), just fetched for
    every participant instead of only "the other" one, so a group
    conversation (Commish's Corner) can show "seen by" per message
    without a new read-tracking table: comparing this against each
    message's own id is enough (see get_conversation_messages)."""
    return await conn.fetch(
        """
        SELECT cp.owner_id, o.display_name, cp.last_read_message_id
        FROM conversation_participants cp
        JOIN owners o ON o.owner_id = cp.owner_id
        LEFT JOIN owner_preferences op ON op.owner_id = cp.owner_id
        WHERE cp.conversation_id = $1
          AND cp.owner_id != $2
          AND COALESCE(op.read_receipts_enabled, true)
        """,
        conversation_id, exclude_owner_id,
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


async def list_eligible_members(conn, active_season: int, league_id: int, exclude_owner_id: int):
    """Every owner with a team in the active season AND league, minus
    the requesting owner — the pool for @mention autocomplete and "new
    message" search. Scoped by league_id since 2026-09-04 (chat used
    to only filter by season, which silently pooled every league's
    owners together once more than one league existed)."""
    return await conn.fetch(
        """
        SELECT DISTINCT o.owner_id, o.display_name, t.team_name
        FROM owners o
        JOIN teams_by_season t ON t.owner_id = o.owner_id
        WHERE t.season = $1 AND t.league_id = $2 AND o.owner_id != $3
        ORDER BY o.display_name
        """,
        active_season, league_id, exclude_owner_id,
    )
