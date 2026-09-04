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
        "title": None if deleted else row["title"],
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
               m.body, m.created_at, m.deleted_at, m.reply_to_id, m.image_url, m.title
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

        # A reaction newer than the last message is the more recent real
        # activity in the conversation — shown as "You reacted ❤️ to
        # '...'" (or "{Name} reacted...") the same way iMessage's own
        # conversation list surfaces a tapback as the latest line,
        # composed here (not left to the frontend) the same way the
        # "📷 Photo" substitution above already is.
        if r["last_reaction_at"] is not None and (
            last_message is None or r["last_reaction_at"] > r["last_message_at"]
        ):
            reactor = "You" if r["last_reaction_owner_id"] == owner_id else r["last_reaction_owner_name"]
            quoted = (r["last_reaction_message_body"] or "").strip() or "a photo"
            if len(quoted) > 30:
                quoted = quoted[:30].rstrip() + "…"
            # owner_name/body are combined by the frontend as
            # "{owner_name}: {body}" for every other last_message shape
            # (see ConversationList.tsx) — body here deliberately omits
            # the reactor's name a second time so that composition still
            # reads correctly instead of doubling it up.
            last_message = {
                "id": r["last_message_id"],
                "owner_name": reactor,
                "body": f"reacted {r['last_reaction_emoji']} to “{quoted}”",
                "created_at": r["last_reaction_at"].isoformat(),
            }
        # Every conversation type is postable except commish_corner,
        # where only the commissioner of ITS OWN league can — computed
        # here (not left for the frontend to infer from "am I my active
        # league's commissioner") so a member of more than one league,
        # or viewing a commish_corner that isn't their currently-active
        # league, still gets the right answer. The real enforcement is
        # still server-side in the WS message handler regardless of
        # this — this only drives whether the composer shows as locked.
        can_post = True
        if r["type"] == "commish_corner":
            can_post = await chat_queries.is_owner_commissioner_of_league(conn, owner_id, r["league_id"])

        # Avatar data for the conversation list: a direct conversation
        # has one real "other person" (already joined into this row); a
        # league/commish_corner conversation has no single other person,
        # so it gets a small cluster of participants instead — fetched
        # per-row rather than batched since a viewer only ever has a
        # couple of these (at most one league + one commish_corner per
        # league they're in), not one per conversation in the whole list.
        avatar_group = None
        if r["type"] in ("league", "commish_corner"):
            avatar_group = [
                {"owner_id": a["owner_id"], "display_name": a["display_name"], "chat_color": a["chat_color"], "logo_url": a["logo_url"]}
                for a in await chat_queries.list_conversation_preview_avatars(conn, r["id"])
            ]

        result.append(
            {
                "id": r["id"],
                "type": r["type"],
                "member_count": r["member_count"],
                "other_owner_id": r["other_owner_id"],
                "other_owner_name": r["other_owner_name"],
                "other_owner_chat_color": r["other_owner_chat_color"],
                "other_owner_logo_url": r["other_owner_logo_url"],
                "other_last_read_message_id": r["other_last_read_message_id"],
                "avatar_group": avatar_group,
                "unread_count": r["unread_count"],
                "last_message": last_message,
                "can_post": can_post,
            }
        )
    return result
