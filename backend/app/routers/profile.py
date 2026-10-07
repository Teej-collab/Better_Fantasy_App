"""
Team profile pages — port of Fantasy_Helper's bot/stats_engine/team_profile.py
(see app/domain/team_profile.py and MIGRATION_MAP.md).

Every endpoint requires real active-league membership (require_league_access)
— this used to be fully public, no auth at all, a real confirmed
vulnerability alongside league.py's (see that router's module docstring
and app/auth/league_context.py's require_league_access for the full story).
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from app.auth.league_context import (
    _decode_session_or_401,
    require_active_league_id,
    require_league_access,
    resolve_owner_id,
)
from app.db import get_pool
from app.domain import team_profile
from app.providers import card_photo_storage
from app.queries import awards as awards_queries
from app.queries import league as league_queries
from app.queries import leagues as leagues_queries

logger = logging.getLogger(__name__)

router = APIRouter(tags=["profile"])


@router.get("/owners")
async def owners(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """Every owner with league history, each with their player-card photo
    (2026-10) as a short-lived signed link — only ever to members of this
    league (require_league_access), and photo_version so apps can cache
    the image across link changes."""
    async with pool.acquire() as conn:
        rows = await league_queries.list_all_owners(conn, league_id)
        photos = {
            r["owner_id"]: r
            for r in await conn.fetch(
                "SELECT owner_id, object_key, updated_at FROM owner_card_photos WHERE league_id = $1", league_id
            )
        }
    result = []
    for r in rows:
        owner = dict(r)
        photo = photos.get(owner["owner_id"])
        owner["photo_url"] = None
        owner["photo_version"] = None
        if photo is not None and card_photo_storage.configured():
            try:
                owner["photo_url"] = card_photo_storage.signed_url(photo["object_key"])
                owner["photo_version"] = int(photo["updated_at"].timestamp())
            except Exception:
                logger.warning("Couldn't sign owner_id=%s's card photo", owner["owner_id"], exc_info=True)
        result.append(owner)
    return {"owners": result}


async def _require_can_edit_card_photo(conn, request: Request, owner_id: int) -> int:
    """You can set your own card photo; a commissioner can set anyone's
    in their league. Returns the league_id."""
    payload = _decode_session_or_401(request)
    league_id = await require_active_league_id(conn, payload)
    in_league = await conn.fetchval(
        "SELECT 1 FROM teams_by_season WHERE owner_id = $1 AND league_id = $2 LIMIT 1", owner_id, league_id
    )
    if not in_league:
        raise HTTPException(status_code=404, detail="That owner isn't in this league")
    if await resolve_owner_id(conn, payload) == owner_id:
        return league_id
    membership = await leagues_queries.get_membership(conn, league_id, payload["user_id"])
    if membership is None or membership["role"] != "commissioner":
        raise HTTPException(status_code=403, detail="Only that owner or a commissioner can change this photo")
    return league_id


@router.post("/owners/{owner_id}/card-photo")
async def upload_card_photo(owner_id: int, request: Request, photo: UploadFile = File(...), pool=Depends(get_pool)):
    if not card_photo_storage.configured():
        raise HTTPException(status_code=503, detail="Photo storage isn't set up")
    content_type = (photo.content_type or "").lower()
    if content_type not in card_photo_storage.CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Use a JPEG, PNG, WebP or HEIC photo")
    data = await photo.read(card_photo_storage.MAX_BYTES + 1)
    if len(data) > card_photo_storage.MAX_BYTES:
        raise HTTPException(status_code=413, detail="That photo is too big (8 MB max)")
    async with pool.acquire() as conn:
        league_id = await _require_can_edit_card_photo(conn, request, owner_id)
    key = card_photo_storage.object_key(league_id, owner_id, content_type)
    await asyncio.to_thread(card_photo_storage.upload, data, key, content_type)
    async with pool.acquire() as conn:
        old = await conn.fetchval(
            "SELECT object_key FROM owner_card_photos WHERE owner_id = $1 AND league_id = $2", owner_id, league_id
        )
        await conn.execute(
            """
            INSERT INTO owner_card_photos (owner_id, league_id, object_key) VALUES ($1, $2, $3)
            ON CONFLICT (owner_id, league_id) DO UPDATE SET object_key = EXCLUDED.object_key, updated_at = now()
            """,
            owner_id, league_id, key,
        )
    if old and old != key:
        try:
            await asyncio.to_thread(card_photo_storage.delete, old)
        except Exception:
            logger.warning("Couldn't delete the old card photo %s", old, exc_info=True)
    return {"status": "uploaded"}


@router.delete("/owners/{owner_id}/card-photo")
async def delete_card_photo(owner_id: int, request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        league_id = await _require_can_edit_card_photo(conn, request, owner_id)
        old = await conn.fetchval(
            "DELETE FROM owner_card_photos WHERE owner_id = $1 AND league_id = $2 RETURNING object_key",
            owner_id, league_id,
        )
    if old and card_photo_storage.configured():
        try:
            await asyncio.to_thread(card_photo_storage.delete, old)
        except Exception:
            logger.warning("Couldn't delete card photo %s", old, exc_info=True)
    return {"status": "removed"}


@router.get("/owners/{owner_id}/profile")
async def season_profile(
    owner_id: int, season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        profile = await team_profile.build_team_profile(conn, season, owner_id, league_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="No profile for this owner/season")
        season_awards = await awards_queries.list_owner_season_awards(conn, owner_id, season, league_id)
    return {**profile, "season_awards": [dict(a) for a in season_awards]}


@router.get("/owners/{owner_id}/career")
async def career_profile(
    owner_id: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        profile = await team_profile.build_career_profile(conn, owner_id, league_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="No career data for this owner")
    return profile


@router.get("/owners/{owner_id}/badges")
async def owner_badges(
    owner_id: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        return await team_profile.get_owner_badges(conn, owner_id, league_id)
