"""
Chug leaderboard endpoints. Deliberately doesn't yet include the Chug
Analyzer (video upload -> chug_scores) or the self-serve "mark
complete"/weekly-status flow (chug_weekly_status) — see TODO.md.
"""
from fastapi import APIRouter, Depends

from app.config import _require
from app.db import get_pool
from app.domain.chug_leaderboard import build_chug_leaderboard
from app.queries import chug as chug_queries

router = APIRouter(prefix="/chug", tags=["chug"])


@router.get("/seasons")
async def chug_seasons(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await chug_queries.list_chug_seasons(conn)
    return {"seasons": [r["season"] for r in rows]}


@router.get("/leaderboard")
async def chug_leaderboard(season: int | None = None, pool=Depends(get_pool)):
    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        leaderboard = await build_chug_leaderboard(conn, active_season, season)
    return {"season": season, "leaderboard": leaderboard}
