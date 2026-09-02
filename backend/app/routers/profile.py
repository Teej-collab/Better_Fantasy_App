"""
Team profile pages — port of Fantasy_Helper's bot/stats_engine/team_profile.py
(see app/domain/team_profile.py and MIGRATION_MAP.md).

Every endpoint requires real active-league membership (require_league_access)
— this used to be fully public, no auth at all, a real confirmed
vulnerability alongside league.py's (see that router's module docstring
and app/auth/league_context.py's require_league_access for the full story).
"""
from fastapi import APIRouter, Depends, HTTPException

from app.auth.league_context import require_league_access
from app.db import get_pool
from app.domain import team_profile
from app.queries import awards as awards_queries
from app.queries import league as league_queries

router = APIRouter(tags=["profile"])


@router.get("/owners")
async def owners(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await league_queries.list_all_owners(conn, league_id)
    return {"owners": [dict(r) for r in rows]}


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
