"""
The Punishment Wheel (2026-10). Each league puts punishments on a wheel
for the season; a commissioner spins it once, and where it lands is the
season's punishment for the league loser.

- Anyone in the league can see the wheel and the result.
- Any member can add punishments until the spin; members can take back
  their own, and commissioners and site admins can remove any.
- Only a commissioner can spin, once per season. The server picks where
  it lands (secrets.randbelow), so nobody can rig it and every phone
  animates to the same answer — open apps get it live over the chat
  WebSocket ("wheel_spin"), everyone gets a push, and it's posted to
  Commish Corner. items_snapshot keeps the wheel as it was, so anyone
  opening it later watches the same spin (the apps replay it once).
"""
import json
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.league_context import _decode_session_or_401, is_site_admin, require_active_league_id, resolve_owner_id
from app.chat.manager import manager
from app.config import _require
from app.db import get_pool
from app.notifications import dispatcher, formatter
from app.queries import chat as chat_queries
from app.queries import leagues as league_queries
from app.queries import owner_preferences as preferences_queries

router = APIRouter(prefix="/punishment-wheel", tags=["punishment-wheel"])
logger = logging.getLogger(__name__)

MAX_ITEMS = 12


async def _context(conn, request: Request) -> dict:
    payload = _decode_session_or_401(request)
    league_id = await require_active_league_id(conn, payload)
    membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
    if membership is None:
        raise HTTPException(status_code=403, detail="You're not in this league")
    commissioner = membership["role"] == "commissioner"
    return {
        "payload": payload,
        "league_id": league_id,
        "season": int(_require("ACTIVE_SEASON")),
        "commissioner": commissioner,
        "can_manage": commissioner or await is_site_admin(conn, payload["user_id"]),
    }


async def _wheel(conn, ctx: dict) -> dict:
    items = await conn.fetch(
        "SELECT id, text, added_by_user_id FROM punishment_wheel_items WHERE league_id = $1 AND season = $2 ORDER BY id",
        ctx["league_id"], ctx["season"],
    )
    spun = await conn.fetchrow(
        """
        SELECT sp.text, sp.landed_index, sp.items_snapshot, sp.spun_at, u.display_name AS spun_by
        FROM season_punishments sp LEFT JOIN users u ON u.id = sp.spun_by_user_id
        WHERE sp.league_id = $1 AND sp.season = $2
        """,
        ctx["league_id"], ctx["season"],
    )
    result = None
    if spun is not None:
        result = {
            "text": spun["text"],
            "landed_index": spun["landed_index"],
            "items": json.loads(spun["items_snapshot"]) if isinstance(spun["items_snapshot"], str) else spun["items_snapshot"],
            "spun_at": spun["spun_at"],
            "spun_by": spun["spun_by"],
        }
    return {
        "season": ctx["season"],
        "items": [
            {
                "id": r["id"],
                "text": r["text"],
                "can_remove": result is None and (ctx["can_manage"] or r["added_by_user_id"] == ctx["payload"]["user_id"]),
            }
            for r in items
        ],
        "result": result,
        "can_edit": result is None,
        "can_spin": ctx["commissioner"] and result is None and len(items) >= 2,
        "is_commissioner": ctx["commissioner"],
    }


@router.get("")
async def get_wheel(request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        ctx = await _context(conn, request)
        return await _wheel(conn, ctx)


class AddItemRequest(BaseModel):
    text: str = Field(min_length=1, max_length=80)


@router.post("/items")
async def add_item(body: AddItemRequest, request: Request, pool=Depends(get_pool)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write a punishment first")
    async with pool.acquire() as conn:
        ctx = await _context(conn, request)
        if await conn.fetchval("SELECT 1 FROM season_punishments WHERE league_id = $1 AND season = $2", ctx["league_id"], ctx["season"]):
            raise HTTPException(status_code=409, detail="The wheel's already been spun this season")
        count = await conn.fetchval(
            "SELECT count(*) FROM punishment_wheel_items WHERE league_id = $1 AND season = $2", ctx["league_id"], ctx["season"]
        )
        if count >= MAX_ITEMS:
            raise HTTPException(status_code=409, detail=f"The wheel holds {MAX_ITEMS} punishments")
        await conn.execute(
            "INSERT INTO punishment_wheel_items (league_id, season, text, added_by_user_id) VALUES ($1, $2, $3, $4)",
            ctx["league_id"], ctx["season"], text, ctx["payload"]["user_id"],
        )
        return await _wheel(conn, ctx)


@router.delete("/items/{item_id}")
async def remove_item(item_id: int, request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        ctx = await _context(conn, request)
        if await conn.fetchval("SELECT 1 FROM season_punishments WHERE league_id = $1 AND season = $2", ctx["league_id"], ctx["season"]):
            raise HTTPException(status_code=409, detail="The wheel's already been spun this season")
        added_by = await conn.fetchval(
            "SELECT added_by_user_id FROM punishment_wheel_items WHERE id = $1 AND league_id = $2 AND season = $3",
            item_id, ctx["league_id"], ctx["season"],
        )
        if added_by is not None and not ctx["can_manage"] and added_by != ctx["payload"]["user_id"]:
            raise HTTPException(status_code=403, detail="Only the commissioner can remove someone else's punishment")
        await conn.execute(
            "DELETE FROM punishment_wheel_items WHERE id = $1 AND league_id = $2 AND season = $3",
            item_id, ctx["league_id"], ctx["season"],
        )
        return await _wheel(conn, ctx)


@router.post("/spin")
async def spin(request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        ctx = await _context(conn, request)
        if not ctx["commissioner"]:
            raise HTTPException(status_code=403, detail="Only the commissioner can spin the wheel")
        async with conn.transaction():
            items = await conn.fetch(
                "SELECT text FROM punishment_wheel_items WHERE league_id = $1 AND season = $2 ORDER BY id FOR UPDATE",
                ctx["league_id"], ctx["season"],
            )
            if len(items) < 2:
                raise HTTPException(status_code=409, detail="Put at least 2 punishments on the wheel first")
            texts = [r["text"] for r in items]
            index = secrets.randbelow(len(texts))
            inserted = await conn.fetchval(
                """
                INSERT INTO season_punishments (league_id, season, text, landed_index, items_snapshot, spun_by_user_id)
                VALUES ($1, $2, $3, $4, $5::jsonb, $6)
                ON CONFLICT (league_id, season) DO NOTHING
                RETURNING 1
                """,
                ctx["league_id"], ctx["season"], texts[index], index, json.dumps(texts), ctx["payload"]["user_id"],
            )
            if not inserted:
                raise HTTPException(status_code=409, detail="The wheel's already been spun this season")
        wheel = await _wheel(conn, ctx)
        await _announce(conn, ctx, texts, index)
    return wheel


async def _announce(conn, ctx: dict, texts: list[str], index: int) -> None:
    """Live to open apps, a push to everyone, and a Commish Corner post.
    Best effort — the spin is already saved."""
    season, league_id = ctx["season"], ctx["league_id"]
    try:
        owner_ids = [
            r["owner_id"]
            for r in await conn.fetch(
                "SELECT DISTINCT owner_id FROM teams_by_season WHERE league_id = $1 AND season = $2 AND owner_id IS NOT NULL",
                league_id, season,
            )
        ]
        await manager.broadcast_to_owners(
            owner_ids,
            {"type": "wheel_spin", "league_id": league_id, "season": season, "landed_index": index, "items": texts, "text": texts[index]},
        )
        spinner_owner = await resolve_owner_id(conn, ctx["payload"])
        payload = formatter.punishment_wheel_result(season, texts[index])
        for owner_id in owner_ids:
            if owner_id == spinner_owner:
                continue
            prefs = await preferences_queries.get_preferences(conn, owner_id)
            if prefs["push_enabled"] and prefs["notify_league"]:
                await dispatcher.send_to_owner(conn, owner_id, payload)
        corner = await conn.fetchval(
            "SELECT id FROM conversations WHERE league_id = $1 AND type = 'commish_corner' LIMIT 1", league_id
        )
        if corner and spinner_owner:
            await chat_queries.insert_message(
                conn, corner, spinner_owner,
                f"The wheel has spoken. Whoever finishes last in {season}: {texts[index]}.",
                None, None, f"🎡 {season} punishment is set",
            )
    except Exception:
        logger.exception("Punishment wheel announcement failed (league_id=%s)", league_id)
