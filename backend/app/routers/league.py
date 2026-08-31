"""
Read-only views: teams, standings, matchups, rosters, rivalries. No auth
required — appropriate for a single private league's own data (public
by design, per the original Phase 5 decision). Season/league-scoped
list endpoints now resolve league_id from the session when one exists
(app/auth/league_context.py's resolve_active_league_id) — a signed-in
visitor sees their own active league's data; a signed-out visitor (or
one with no active league selected) still sees League #1's public
preview, same behavior as before per-user league selection existed.
Endpoints keyed by an opaque numeric id (matchup_id, team_id) stay
fully public either way — those are shareable permalinks, not a
"browse the whole league" view.
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.league_context import resolve_active_league_id
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.db import get_pool
from app.domain.league_ticker import get_week_ticker_data
from app.domain.matchup_context import build_matchup_detail, build_week_matchup_context
from app.domain.records import get_record_book
from app.domain import power_rankings
from app.queries import league as queries

router = APIRouter(tags=["league"])


def _decode_session(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


@router.get("/seasons")
async def seasons(request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return {"seasons": await queries.list_seasons(conn, league_id)}


@router.get("/seasons/{season}/current-week")
async def current_week(season: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        week = await queries.get_cached_current_week(conn, season)
    return {"season": season, "current_week": week}


@router.get("/seasons/{season}/teams")
async def teams(season: int, request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        rows = await queries.list_teams(conn, season, league_id)
    return {"teams": [dict(r) for r in rows]}


@router.get("/seasons/{season}/standings")
async def standings(season: int, request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        rows = await queries.get_standings(conn, season, league_id)
    return {"standings": [dict(r) for r in rows]}


@router.get("/seasons/{season}/weeks/{week}/matchups")
async def week_matchups(season: int, week: int, request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        rows = await queries.list_week_matchups(conn, season, week, league_id)
    return {"matchups": [dict(r) for r in rows]}


@router.get("/seasons/{season}/weeks/{week}/matchup-context")
async def week_matchup_context(season: int, week: int, request: Request, pool=Depends(get_pool)):
    """Everything the matchup expand-card needs for every matchup in the
    week, in one call — see app/domain/matchup_context.py."""
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return await build_week_matchup_context(conn, season, week, league_id)


@router.get("/seasons/{season}/weeks/{week}/ticker")
async def week_ticker(season: int, week: int, request: Request, pool=Depends(get_pool)):
    """Lightweight feed for the league scores ticker (as opposed to
    /matchup-context, which is much heavier) — see
    app/domain/league_ticker.py."""
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return await get_week_ticker_data(conn, season, week, league_id)


@router.get("/records")
async def record_book(request: Request, pool=Depends(get_pool)):
    """All-time record book — top 3 per category, computed live on every
    request (see app/domain/records.py) so a new result shows up here
    the instant it's synced, not on some separate refresh cadence. Not
    season-scoped — spans the league's whole history."""
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return await get_record_book(conn, league_id)


@router.get("/seasons/{season}/weeks/{week}/power-rankings")
async def week_power_rankings(season: int, week: int, request: Request, pool=Depends(get_pool)):
    """This week's power rankings (with luck/SOS alongside, and
    movement vs. last week) — see app/domain/power_rankings.py."""
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return {"rankings": await power_rankings.get_week_power_rankings(conn, season, week, league_id)}


@router.get("/seasons/{season}/power-rankings/latest-week")
async def latest_power_rankings_week(season: int, request: Request, pool=Depends(get_pool)):
    """The most recent week this season that actually has power rankings
    computed — lets the frontend default the "This Week" view to real
    data instead of guessing a week number that might not be synced yet."""
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        week = await power_rankings.get_latest_ranked_week(conn, season, league_id)
    return {"week": week}


@router.get("/seasons/{season}/power-rankings/trend")
async def season_power_rankings_trend(season: int, request: Request, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return {"teams": await power_rankings.get_season_trend(conn, season, league_id)}


@router.get("/power-rankings/all-time")
async def all_time_power_rankings(request: Request, pool=Depends(get_pool)):
    """All-time Power Rankings / Luck Index / Strength of Schedule
    leaderboards — same "computed live, not stored" convention as
    /records."""
    async with pool.acquire() as conn:
        league_id = await resolve_active_league_id(conn, _decode_session(request))
        return await power_rankings.get_all_time_indices(conn, league_id)


@router.get("/matchups/{matchup_id}")
async def matchup_detail(matchup_id: int, pool=Depends(get_pool)):
    """Full matchup detail — box score, win probability, real head-to-
    head, rivalry, streaks, bench crime/clutch-choke callouts, and (once
    app/domain/narrative_engine.py is wired in) the write-up. Same
    per-matchup shape /seasons/{s}/weeks/{w}/matchup-context returns for
    one of its entries — see app/domain/matchup_context.py."""
    async with pool.acquire() as conn:
        detail = await build_matchup_detail(conn, matchup_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Matchup not found")
    return detail


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
    """Not yet league-scoped (rivalries has no league_id column at all —
    a known, separate gap, see TODO.md's PHASE 9 entry) — stays global
    for now, same as before."""
    async with pool.acquire() as conn:
        rows = await queries.list_rivalries(conn)
    return {"rivalries": [dict(r) for r in rows]}
