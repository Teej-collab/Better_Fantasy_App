"""
Read-only views: teams, standings, matchups, rosters, rivalries. No auth
(Phase 5 decision doesn't gate this) — everything here is public read
access, appropriate for a single private league's own data.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.queries import league as queries

router = APIRouter(tags=["league"])


@router.get("/seasons")
async def seasons(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        return {"seasons": await queries.list_seasons(conn)}


@router.get("/seasons/{season}/teams")
async def teams(season: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await queries.list_teams(conn, season)
    return {"teams": [dict(r) for r in rows]}


@router.get("/seasons/{season}/standings")
async def standings(season: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await queries.get_standings(conn, season)
    return {"standings": [dict(r) for r in rows]}


@router.get("/seasons/{season}/weeks/{week}/matchups")
async def week_matchups(season: int, week: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await queries.list_week_matchups(conn, season, week)
    return {"matchups": [dict(r) for r in rows]}


@router.get("/matchups/{matchup_id}")
async def matchup_detail(matchup_id: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        matchup = await queries.get_matchup(conn, matchup_id)
        if matchup is None:
            raise HTTPException(status_code=404, detail="Matchup not found")
        home_roster = await queries.get_roster(conn, matchup["home_team_id"], matchup["week"])
        away_roster = await queries.get_roster(conn, matchup["away_team_id"], matchup["week"])
    return {
        **dict(matchup),
        "home_roster": [dict(r) for r in home_roster],
        "away_roster": [dict(r) for r in away_roster],
    }


@router.get("/teams/{team_id}")
async def team_detail(team_id: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        team = await queries.get_team(conn, team_id)
        if team is None:
            raise HTTPException(status_code=404, detail="Team not found")
    return dict(team)


@router.get("/teams/{team_id}/roster")
async def team_roster(team_id: int, week: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        team = await queries.get_team(conn, team_id)
        if team is None:
            raise HTTPException(status_code=404, detail="Team not found")
        rows = await queries.get_roster(conn, team_id, week)
    return {"team": dict(team), "week": week, "roster": [dict(r) for r in rows]}


@router.get("/rivalries")
async def rivalries(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await queries.list_rivalries(conn)
    return {"rivalries": [dict(r) for r in rows]}
