"""
Assembles the full message/conversation JSON shapes the frontend
needs, batch-fetching reactions/reply-previews/mentions instead of
querying per-message — same N+1-avoidance discipline as the weekly
awards rewrite earlier this session. See app/queries/chat.py for the
underlying reads.
"""
from app.queries import chat as chat_queries


def _serialize_message_row(row, reply_previews: dict, reactions_by_message: dict, mentions_by_message: dict):
    deleted = row["deleted_at"] is not None
    reply_to = reply_previews.get(row["reply_to_id"]) if row["reply_to_id"] else None
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "owner_id": row["owner_id"],
        "owner_name": row["owner_name"],
        "owner_chat_color": row["owner_chat_color"],
        "owner_logo_url": row["owner_logo_url"],
        "body": "This message was deleted." if deleted else row["body"],
        "image_url": None if deleted else row["image_url"],
        "deleted": deleted,
        "created_at": row["created_at"].isoformat(),
        "reply_to": reply_to,
        "mentions": mentions_by_message.get(row["id"], []),
        "reactions": reactions_by_message.get(row["id"], []),
    }


async def get_conversation_messages(conn, conversation_id: int, before_id: int | None, limit: int, requesting_owner_id: int):
    rows = await chat_queries.list_messages(conn, conversation_id, before_id, limit)
    if not rows:
        return []

    message_ids = [r["id"] for r in rows]
    reply_to_ids = [r["reply_to_id"] for r in rows if r["reply_to_id"] is not None]

    reply_rows = await chat_queries.get_messages_by_id(conn, reply_to_ids)
    reply_previews = {
        r["id"]: {
            "id": r["id"],
            "owner_name": r["owner_name"],
            "body": "This message was deleted."
            if r["deleted_at"] is not None
            else (r["body"] or ("📷 Photo" if r["image_url"] else "")),
        }
        for r in reply_rows
    }

    reaction_rows = await chat_queries.get_reactions_for_messages(conn, message_ids, requesting_owner_id)
    reactions_by_message: dict[int, list] = {}
    for r in reaction_rows:
        reactions_by_message.setdefault(r["message_id"], []).append(
            {"emoji": r["emoji"], "count": r["count"], "reacted_by_me": r["reacted_by_me"]}
        )

    mention_rows = await chat_queries.get_mentions_for_messages(conn, message_ids)
    mentions_by_message: dict[int, list] = {}
    for r in mention_rows:
        mentions_by_message.setdefault(r["message_id"], []).append(r["owner_id"])

    return [_serialize_message_row(r, reply_previews, reactions_by_message, mentions_by_message) for r in rows]


async def get_single_message(conn, message_id: int, requesting_owner_id: int):
    """Used to build the payload broadcast over the WebSocket right
    after a send — same shape as a page of history, just for one
    message, so the frontend can reuse one message-rendering path."""
    messages = await get_conversation_messages_by_ids(conn, [message_id], requesting_owner_id)
    return messages[0] if messages else None


async def get_conversation_messages_by_ids(conn, message_ids: list[int], requesting_owner_id: int):
    if not message_ids:
        return []
    rows = await conn.fetch(
        """
        SELECT m.id, m.conversation_id, m.owner_id, o.display_name AS owner_name, o.chat_color AS owner_chat_color,
               o.logo_url AS owner_logo_url,
               m.body, m.created_at, m.deleted_at, m.reply_to_id, m.image_url
        FROM messages m JOIN owners o ON o.owner_id = m.owner_id
        WHERE m.id = ANY($1::int[])
        ORDER BY m.id
        """,
        message_ids,
    )
    reply_to_ids = [r["reply_to_id"] for r in rows if r["reply_to_id"] is not None]
    reply_rows = await chat_queries.get_messages_by_id(conn, reply_to_ids)
    reply_previews = {
        r["id"]: {
            "id": r["id"],
            "owner_name": r["owner_name"],
            "body": "This message was deleted."
            if r["deleted_at"] is not None
            else (r["body"] or ("📷 Photo" if r["image_url"] else "")),
        }
        for r in reply_rows
    }
    reaction_rows = await chat_queries.get_reactions_for_messages(conn, message_ids, requesting_owner_id)
    reactions_by_message: dict[int, list] = {}
    for r in reaction_rows:
        reactions_by_message.setdefault(r["message_id"], []).append(
            {"emoji": r["emoji"], "count": r["count"], "reacted_by_me": r["reacted_by_me"]}
        )
    mention_rows = await chat_queries.get_mentions_for_messages(conn, message_ids)
    mentions_by_message: dict[int, list] = {}
    for r in mention_rows:
        mentions_by_message.setdefault(r["message_id"], []).append(r["owner_id"])

    return [_serialize_message_row(r, reply_previews, reactions_by_message, mentions_by_message) for r in rows]


async def get_conversations_summary(conn, owner_id: int):
    rows = await chat_queries.list_conversations_for_owner(conn, owner_id)
    result = []
    for r in rows:
        last_message = None
        if r["last_message_id"] is not None:
            deleted = r["last_message_deleted_at"] is not None
            body = r["last_message_body"]
            if deleted:
                body = "This message was deleted."
            elif not body and r["last_message_image_url"]:
                body = "📷 Photo"
            last_message = {
                "id": r["last_message_id"],
                "owner_name": r["last_message_owner_name"],
                "body": body,
                "created_at": r["last_message_at"].isoformat(),
            }
        result.append(
            {
                "id": r["id"],
                "type": r["type"],
                "member_count": r["member_count"],
                "other_owner_id": r["other_owner_id"],
                "other_owner_name": r["other_owner_name"],
                "unread_count": r["unread_count"],
                "last_message": last_message,
            }
        )
    return result
