"""
Weekend League Chat v2 — conversations (one shared league conversation
+ 1:1 direct conversations), replies, soft deletes, reactions,
mentions, typing indicators, and read state. See app/domain/chat.py,
app/queries/chat.py, migration 03417db98bb5, and app/chat/manager.py.

History/conversation list/reactions/reads/deletes are plain REST so
the frontend can server-render on page load and use ordinary request/
response flows for actions; new messages and typing indicators go over
one persistent WebSocket per client (app/chat/manager.py), which also
rebroadcasts reaction/delete/read events after the REST call that
triggered them so every open tab stays in sync without polling.

Every route checks conversation membership server-side
(chat_queries.is_participant) before returning or mutating anything —
never trusts the client's own idea of which conversations it can see.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from urllib.parse import urlparse

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, decode_ticket_token
from app.chat.manager import manager
from app.config import CHAT_IMAGE_HOST, _require
from app.db import get_pool
from app.domain import chat as chat_domain
from app.notifications import dispatcher, formatter
from app.queries import chat as chat_queries
from app.queries import owner_preferences as preferences_queries

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

MAX_MESSAGE_LENGTH = 2000
DEFAULT_PAGE_SIZE = 50
ALLOWED_REACTIONS = {"😂", "🔥", "💀", "👍", "❤️", "😭"}


def _validate_image_url(value) -> str | None:
    """Only ever persist a link to our own Blob store, over HTTPS —
    never trust an arbitrary URL a client sends over the socket."""
    if not isinstance(value, str) or not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != CHAT_IMAGE_HOST:
        return None
    return value


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.get("/conversations")
async def list_conversations(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        conversations = await chat_domain.get_conversations_summary(conn, payload["owner_id"])
    return {"conversations": conversations}


@router.get("/conversations/{conversation_id}/messages")
async def get_messages(
    conversation_id: int, request: Request, before: int | None = Query(None), limit: int = Query(DEFAULT_PAGE_SIZE, le=100),
    pool=Depends(get_pool),
):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        if not await chat_queries.is_participant(conn, conversation_id, payload["owner_id"]):
            raise HTTPException(status_code=403, detail="Not a participant in this conversation")
        messages = await chat_domain.get_conversation_messages(conn, conversation_id, before, limit, payload["owner_id"])
    return {"messages": messages}


@router.post("/conversations/direct")
async def start_direct_conversation(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    body = await request.json()
    target_owner_id = body.get("owner_id")
    if not isinstance(target_owner_id, int):
        raise HTTPException(status_code=400, detail="owner_id is required")
    if target_owner_id == payload["owner_id"]:
        raise HTTPException(status_code=400, detail="Can't start a conversation with yourself")

    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        eligible_ids = {m["owner_id"] for m in await chat_queries.list_eligible_members(conn, active_season, payload["owner_id"])}
        if target_owner_id not in eligible_ids:
            raise HTTPException(status_code=404, detail="Not a current league member")
        conversation_id = await chat_queries.get_or_create_direct_conversation(conn, payload["owner_id"], target_owner_id)
    return {"conversation_id": conversation_id}


@router.get("/members")
async def list_members(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        rows = await chat_queries.list_eligible_members(conn, active_season, payload["owner_id"])
    return {"members": [dict(r) for r in rows]}


@router.post("/conversations/{conversation_id}/read")
async def mark_conversation_read(conversation_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        if not await chat_queries.is_participant(conn, conversation_id, payload["owner_id"]):
            raise HTTPException(status_code=403, detail="Not a participant in this conversation")
        latest_id = await chat_queries.get_latest_message_id(conn, conversation_id)
        if latest_id is not None:
            # last_read_message_id itself always updates, regardless of
            # the Read Receipts preference below — it's what this
            # owner's OWN unread count is computed from (get_messages
            # via chat_domain), not just a signal to other people.
            await chat_queries.mark_read(conn, conversation_id, payload["owner_id"], latest_id)
            participant_ids = await chat_queries.list_conversation_participant_ids(conn, conversation_id)
            read_receipts_enabled = (await preferences_queries.get_preferences(conn, payload["owner_id"]))[
                "read_receipts_enabled"
            ]

    # Read Receipts OFF means everyone else simply never finds out this
    # owner read anything — the broadcast just doesn't go out.
    if latest_id is not None and read_receipts_enabled:
        await manager.broadcast_to_owners(
            [p for p in participant_ids if p != payload["owner_id"]],
            {
                "type": "read",
                "conversation_id": conversation_id,
                "owner_id": payload["owner_id"],
                "last_read_message_id": latest_id,
            },
        )
    return {"last_read_message_id": latest_id}


@router.post("/messages/{message_id}/react")
async def react_to_message(message_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    body = await request.json()
    emoji = body.get("emoji")
    if emoji not in ALLOWED_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported reaction — expected one of {sorted(ALLOWED_REACTIONS)}")

    async with pool.acquire() as conn:
        target = await chat_queries.get_message_owner_and_conversation(conn, message_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Message not found")
        if not await chat_queries.is_participant(conn, target["conversation_id"], payload["owner_id"]):
            raise HTTPException(status_code=403, detail="Not a participant in this conversation")

        added = await chat_queries.toggle_reaction(conn, message_id, payload["owner_id"], emoji)
        participant_ids = await chat_queries.list_conversation_participant_ids(conn, target["conversation_id"])

    await manager.broadcast_to_owners(
        participant_ids,
        {
            "type": "reaction",
            "message_id": message_id,
            "conversation_id": target["conversation_id"],
            "emoji": emoji,
            "owner_id": payload["owner_id"],
            "added": added,
        },
    )
    return {"added": added}


@router.delete("/messages/{message_id}")
async def delete_message(message_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        target = await chat_queries.get_message_owner_and_conversation(conn, message_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Message not found")
        if target["owner_id"] != payload["owner_id"]:
            raise HTTPException(status_code=403, detail="Can only delete your own messages")

        await chat_queries.soft_delete_message(conn, message_id)
        participant_ids = await chat_queries.list_conversation_participant_ids(conn, target["conversation_id"])

    await manager.broadcast_to_owners(
        participant_ids,
        {"type": "deleted", "message_id": message_id, "conversation_id": target["conversation_id"]},
    )
    return {"status": "deleted"}


async def _push_notify_new_message(
    conversation_id: int, sender_id: int, sender_name: str, body: str,
    reply_to_id: int | None, mentioned_ids: list[int], participant_ids: list[int],
) -> None:
    """Web Push side effect of a chat message, alongside the WebSocket
    broadcast above — reuses the same owner_preferences categories the
    Notifications settings page already exposes (notify_direct_messages/
    notify_league_chat/notify_mentions/notify_replies), so this is
    activating existing preference plumbing, not inventing new toggles.
    Never lets a notification failure break the chat send itself — the
    WebSocket broadcast above has already happened by the time this
    runs, so a bug or a dead push provider here can't cost anyone their
    message."""
    others = [p for p in participant_ids if p != sender_id and not manager.is_connected(p)]
    if not others:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            reply_target_owner_id = None
            if reply_to_id is not None:
                original = await chat_queries.get_message_owner_and_conversation(conn, reply_to_id)
                reply_target_owner_id = original["owner_id"] if original else None
            conversation_type = await chat_queries.get_conversation_type(conn, conversation_id)

            for recipient_id in others:
                if recipient_id in mentioned_ids:
                    category, build = "notify_mentions", formatter.chat_mention
                elif recipient_id == reply_target_owner_id:
                    category, build = "notify_replies", formatter.chat_reply
                elif conversation_type == "direct":
                    category, build = "notify_direct_messages", formatter.chat_direct_message
                else:
                    category, build = "notify_league_chat", formatter.chat_league_message

                prefs = await preferences_queries.get_preferences(conn, recipient_id)
                if prefs["push_enabled"] and prefs[category]:
                    await dispatcher.send_to_owner(conn, recipient_id, build(sender_name, body))
    except Exception:
        logger.exception("Push notification for chat message in conversation_id=%s failed", conversation_id)


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket, ticket: str | None = None):
    payload = _decode_session(websocket.cookies.get(SESSION_COOKIE_NAME))
    if payload is None and ticket:
        # Cookie-based auth failed (or was never sent — Safari's ITP
        # blocks it on this exact kind of cross-site request) — fall
        # back to the short-lived ticket the client mints via its own
        # first-party cookie instead. See app/auth/session.py and
        # /auth/ticket in app/routers/auth.py.
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="ws")
    if payload is None:
        await websocket.close(code=4401)
        return

    owner_id = payload["owner_id"]
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Session JWT carries discord_user_id, not display_name — fetched
        # once per connection (not per keystroke) and reused for every
        # typing-indicator broadcast below.
        owner_name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)

    await manager.connect(owner_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            event_type = data.get("type")
            conversation_id = data.get("conversation_id")
            if not isinstance(conversation_id, int):
                continue

            async with pool.acquire() as conn:
                is_member = await chat_queries.is_participant(conn, conversation_id, owner_id)
            if not is_member:
                continue

            if event_type == "message":
                body = str(data.get("body", "")).strip()
                image_url = _validate_image_url(data.get("image_url"))
                if (not body and not image_url) or len(body) > MAX_MESSAGE_LENGTH:
                    continue
                reply_to_id = data.get("reply_to_id")
                if not isinstance(reply_to_id, int):
                    reply_to_id = None
                raw_mentions = data.get("mentions") or []
                mentions = [m for m in raw_mentions if isinstance(m, int)]

                async with pool.acquire() as conn:
                    participant_ids = await chat_queries.list_conversation_participant_ids(conn, conversation_id)
                    # Never trust the client's mention list outright — only
                    # people actually in this conversation can be mentioned.
                    valid_mentions = [m for m in mentions if m in participant_ids]

                    row = await chat_queries.insert_message(
                        conn, conversation_id, owner_id, body, reply_to_id, image_url
                    )
                    await chat_queries.insert_mentions(conn, row["id"], valid_mentions)
                    message = await chat_domain.get_single_message(conn, row["id"], owner_id)

                await manager.broadcast_to_owners(participant_ids, {"type": "message", "message": message})
                await _push_notify_new_message(
                    conversation_id, owner_id, owner_name or "Someone", body, reply_to_id, valid_mentions, participant_ids
                )

            elif event_type == "typing":
                async with pool.acquire() as conn:
                    participant_ids = await chat_queries.list_conversation_participant_ids(conn, conversation_id)
                    typing_indicators_enabled = (await preferences_queries.get_preferences(conn, owner_id))[
                        "typing_indicators_enabled"
                    ]
                # Enforced server-side, not just skipped client-side — a
                # modified client sending "typing" anyway still can't
                # reveal this owner's typing state to anyone else.
                if typing_indicators_enabled:
                    await manager.broadcast_to_owners(
                        [p for p in participant_ids if p != owner_id],
                        {
                            "type": "typing",
                            "conversation_id": conversation_id,
                            "owner_id": owner_id,
                            "owner_name": owner_name or "Someone",
                        },
                    )
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(owner_id, websocket)
