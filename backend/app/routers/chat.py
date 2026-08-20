"""
League-wide chat — a single shared room, no channels or DMs in this
first version (nothing in the product ask called for those, and a
~12-person league doesn't obviously need them yet).

History is a plain REST endpoint (GET /chat/messages) so the frontend
page can server-render the recent log with zero loading flash, same
pattern as /me/week; live delivery after that is a WebSocket
(WS /chat/ws) so new messages appear without polling. Both read the
same session cookie /auth/me does — the WebSocket handshake carries
cookies the same way a normal HTTP request does, so no separate
token/query-param auth scheme is needed.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.chat.manager import manager
from app.db import get_pool
from app.queries import chat as chat_queries

router = APIRouter(prefix="/chat", tags=["chat"])

MAX_MESSAGE_LENGTH = 2000


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


@router.get("/messages")
async def list_messages(request: Request, pool=Depends(get_pool)):
    if _decode_session(request.cookies.get(SESSION_COOKIE_NAME)) is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    async with pool.acquire() as conn:
        rows = await chat_queries.list_recent_messages(conn)
    return {"messages": [dict(r) for r in rows]}


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    payload = _decode_session(websocket.cookies.get(SESSION_COOKIE_NAME))
    if payload is None:
        # 4401: WebSocket close codes in the 4000-4999 range are
        # application-defined — there's no standard "unauthorized" close
        # code the way HTTP has 401, so this just echoes that number for
        # a client-side handler to recognize.
        await websocket.close(code=4401)
        return

    owner_id = payload["owner_id"]
    await manager.connect(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                body = str(data.get("body", "")).strip()
            except (json.JSONDecodeError, AttributeError):
                continue
            if not body or len(body) > MAX_MESSAGE_LENGTH:
                continue

            pool = await get_pool()
            async with pool.acquire() as conn:
                row = await chat_queries.insert_message(conn, owner_id, body)
                owner = await conn.fetchrow("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)

            await manager.broadcast(
                {
                    "id": row["id"],
                    "owner_id": owner_id,
                    "owner_name": owner["display_name"] if owner else None,
                    "body": row["body"],
                    "created_at": row["created_at"].isoformat(),
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
