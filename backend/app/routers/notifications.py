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


# ---- Per league (2026-11-08) ------------------------------------------------
# Settings > Notifications > Your leagues: for each league, everything (no
# row), just your team ("mine"), or muted ("off"). The dispatcher reads it.

_LEVELS = {"all", "mine", "off"}


async def _owner_or_404(conn, user_id: int) -> int:
    owner_id = await conn.fetchval("SELECT owner_id FROM owner_users WHERE user_id = $1", user_id)
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Join a league first")
    return owner_id


async def _league_rows(conn, owner_id: int):
    return await conn.fetch(
        """
        SELECT DISTINCT l.id AS league_id, l.name, COALESCE(n.level, 'all') AS level
        FROM owner_users ou
        JOIN league_members lm ON lm.user_id = ou.user_id
        JOIN leagues l ON l.id = lm.league_id
        LEFT JOIN league_notification_levels n ON n.owner_id = ou.owner_id AND n.league_id = l.id
        WHERE ou.owner_id = $1
        ORDER BY l.name
        """,
        owner_id,
    )


@router.get("/leagues")
async def league_levels(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval("SELECT owner_id FROM owner_users WHERE user_id = $1", payload["user_id"])
        if owner_id is None:
            return {"leagues": []}
        return {"leagues": [dict(r) for r in await _league_rows(conn, owner_id)]}


class LevelBody(BaseModel):
    level: str


@router.put("/leagues/{league_id}")
async def set_league_level(league_id: int, body: LevelBody, request: Request):
    payload = _require_session(request)
    if body.level not in _LEVELS:
        raise HTTPException(status_code=400, detail="level must be all, mine or off")
    pool = await get_pool()
    async with pool.acquire() as conn:
        owner_id = await _owner_or_404(conn, payload["user_id"])
        rows = await _league_rows(conn, owner_id)
        if not any(r["league_id"] == league_id for r in rows):
            raise HTTPException(status_code=404, detail="You're not in that league")
        if body.level == "all":
            await conn.execute("DELETE FROM league_notification_levels WHERE owner_id = $1 AND league_id = $2", owner_id, league_id)
        else:
            await conn.execute(
                """
                INSERT INTO league_notification_levels (owner_id, league_id, level) VALUES ($1, $2, $3)
                ON CONFLICT (owner_id, league_id) DO UPDATE SET level = EXCLUDED.level, updated_at = now()
                """,
                owner_id, league_id, body.level,
            )
        return {"leagues": [dict(r) for r in await _league_rows(conn, owner_id)]}
