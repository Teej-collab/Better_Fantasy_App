"""
Team profile pages — port of Fantasy_Helper's bot/stats_engine/team_profile.py
(see app/domain/team_profile.py and MIGRATION_MAP.md). Public, no auth,
same as the rest of the league data.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.domain import team_profile
from app.queries import awards as awards_queries
from app.queries import league as league_queries

router = APIRouter(tags=["profile"])


@router.get("/owners")
async def owners(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await league_queries.list_all_owners(conn)
    return {"owners": [dict(r) for r in rows]}


@router.get("/owners/{owner_id}/profile")
async def season_profile(owner_id: int, season: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        profile = await team_profile.build_team_profile(conn, season, owner_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="No profile for this owner/season")
        season_awards = await awards_queries.list_owner_season_awards(conn, owner_id, season)
    return {**profile, "season_awards": [dict(a) for a in season_awards]}


@router.get("/owners/{owner_id}/career")
async def career_profile(owner_id: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        profile = await team_profile.build_career_profile(conn, owner_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="No career data for this owner")
    return profile


@router.get("/owners/{owner_id}/badges")
async def owner_badges(owner_id: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        return await team_profile.get_owner_badges(conn, owner_id)
