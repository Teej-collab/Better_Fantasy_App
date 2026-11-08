"""The notification inbox (2026-11-08): what we've pushed you in the last
30 days, newest first, whether it reached a device or not (quiet hours,
a phone that was off). Kept by app/notifications/dispatcher.py's record.
An account with a team reads its team's (owner) inbox; one without (a
survivor-only player) its own."""
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.config import SessionConfig
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


async def _recipient(conn, user_id: int) -> tuple[str, int]:
    owner_id = await conn.fetchval("SELECT owner_id FROM owner_users WHERE user_id = $1", user_id)
    return ("owner_id", owner_id) if owner_id is not None else ("user_id", user_id)


@router.get("")
async def list_notifications(request: Request, limit: int = 60):
    payload = _require_session(request)
    limit = max(1, min(limit, 100))
    pool = await get_pool()
    async with pool.acquire() as conn:
        column, rid = await _recipient(conn, payload["user_id"])
        rows = await conn.fetch(
            f"""
            SELECT id, type, title, body, url, data, created_at, read_at IS NOT NULL AS read
            FROM notifications WHERE {column} = $1
            ORDER BY created_at DESC, id DESC LIMIT $2
            """,
            rid, limit,
        )
        unread = await conn.fetchval(f"SELECT count(*) FROM notifications WHERE {column} = $1 AND read_at IS NULL", rid)
    return {
        "notifications": [{**dict(r), "data": json.loads(r["data"])} for r in rows],
        "unread": unread,
    }


@router.get("/unread")
async def unread_count(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        column, rid = await _recipient(conn, payload["user_id"])
        return {"unread": await conn.fetchval(f"SELECT count(*) FROM notifications WHERE {column} = $1 AND read_at IS NULL", rid)}


class ReadBody(BaseModel):
    # None marks everything read.
    ids: list[int] | None = Field(default=None, max_length=200)


@router.post("/read")
async def mark_read(body: ReadBody, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        column, rid = await _recipient(conn, payload["user_id"])
        await conn.execute(
            f"""
            UPDATE notifications SET read_at = now()
            WHERE {column} = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))
            """,
            rid, body.ids,
        )
        return {"unread": await conn.fetchval(f"SELECT count(*) FROM notifications WHERE {column} = $1 AND read_at IS NULL", rid)}
