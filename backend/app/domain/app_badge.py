"""
The red number on the app icon (2026-10-23): unread chat messages
across every chat the owner is in, plus, for a commissioner, the trades
waiting on their review. Sent with every iPhone push
(app/notifications/apns_client.py) so the icon updates while the app
is closed, and read by the app itself at GET /chat/badge so it drops
the moment something is read.

Unread is counted the same way the chat list counts it
(app/queries/chat.py's list_conversations_for_owner), minus hidden
chats and watch-party rooms, but across all of the owner's leagues —
pushes come from all of them, so the number should too.

Counting must never stop a push from going out, so failures are
logged and read as "no badge" (None), which leaves the icon as it is.
"""
import logging

logger = logging.getLogger(__name__)

REVIEW_STATUSES = ("awaiting_review", "in_review")


async def counts(conn, owner_ids: list[int]) -> dict[int, dict]:
    """{owner_id: {"chat": n, "commish": n, "total": n}} for each owner."""
    owner_ids = list(dict.fromkeys(owner_ids))
    result = {o: {"chat": 0, "commish": 0, "total": 0} for o in owner_ids}
    if not owner_ids:
        return result
    async with conn.transaction():
        chat_rows = await conn.fetch(
            """
            SELECT cp.owner_id, COUNT(m.id) AS n
            FROM conversation_participants cp
            JOIN conversations c ON c.id = cp.conversation_id
            JOIN messages m ON m.conversation_id = cp.conversation_id
            WHERE cp.owner_id = ANY($1::int[])
              AND NOT cp.hidden
              AND c.type != 'watch_party'
              AND m.deleted_at IS NULL
              AND m.owner_id != cp.owner_id
              AND (cp.last_read_message_id IS NULL OR m.id > cp.last_read_message_id)
              AND (cp.cleared_message_id IS NULL OR m.id > cp.cleared_message_id)
            GROUP BY cp.owner_id
            """,
            owner_ids,
        )
        commish_rows = await conn.fetch(
            """
            SELECT ou.owner_id, COUNT(DISTINCT t.id) AS n
            FROM owner_users ou
            JOIN league_members lm ON lm.user_id = ou.user_id AND lm.role = 'commissioner'
            JOIN trades t ON t.league_id = lm.league_id AND t.status = ANY($2::text[])
            WHERE ou.owner_id = ANY($1::int[])
            GROUP BY ou.owner_id
            """,
            owner_ids, list(REVIEW_STATUSES),
        )
    for row in chat_rows:
        result[row["owner_id"]]["chat"] = row["n"]
    for row in commish_rows:
        result[row["owner_id"]]["commish"] = row["n"]
    for value in result.values():
        value["total"] = value["chat"] + value["commish"]
    return result


async def totals(conn, owner_ids: list[int]) -> dict[int, int | None]:
    """{owner_id: badge number} for the push sender; None for everyone
    when counting fails, so the push still goes out without one."""
    try:
        return {o: c["total"] for o, c in (await counts(conn, owner_ids)).items()}
    except Exception:
        logger.warning("Couldn't count app badges", exc_info=True)
        return {o: None for o in owner_ids}
