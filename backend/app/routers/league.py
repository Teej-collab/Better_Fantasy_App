"""
Read-only views: teams, standings, matchups, rosters, rivalries.

Every endpoint here requires a real signed-in session AND real active-
league membership (via require_league_access) — this used to be "no
auth at all," a real, confirmed vulnerability (2026-09 audit): any
signed-in account, including one that had never joined any league,
could read this league's full standings/rosters/rivalries. That was a
defensible-at-the-time assumption back when this was a single, closed,
Discord-invite-only league with no self-serve signup — it silently
stopped being true once email/Discord/Google self-serve signup and
multi-league support shipped. See app/auth/league_context.py's
require_league_access docstring for the full story.

/seasons and /seasons/{season}/current-week are the two exceptions,
left ungated: a list of synced season years and "what NFL week is it"
carry no league-private information (no team/owner/score/roster data),
so gating them would just add friction to genuinely non-sensitive
lookups without closing any real exposure.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.auth.league_context import require_league_access
from app.db import get_pool
from app.domain.league_ticker import get_week_ticker_data
from app.domain.matchup_context import build_matchup_detail, build_week_matchup_context
from app.domain.records import get_record_book
from app.domain import playoffs
from app.domain import power_rankings
from app.domain import waivers
from app.queries import league as queries

router = APIRouter(tags=["league"])


@router.get("/seasons")
async def seasons(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        return {"seasons": await queries.list_seasons(conn)}


@router.get("/seasons/{season}/current-week")
async def current_week(season: int, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        week = await queries.get_cached_current_week(conn, season)
    return {"season": season, "current_week": week}


@router.get("/seasons/{season}/teams")
async def teams(season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await queries.list_teams(conn, season, league_id)
    return {"teams": [dict(r) for r in rows]}


@router.get("/seasons/{season}/standings")
async def standings(season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await queries.get_standings(conn, season, league_id)
        playoff_team_count = await queries.get_playoff_team_count(conn, season, league_id)
    return {"standings": [dict(r) for r in rows], "playoff_team_count": playoff_team_count}


@router.get("/seasons/{season}/playoffs/bracket")
async def playoff_bracket(season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """The real in-app playoff bracket (app/domain/playoffs.py) — empty
    `nodes` before a commissioner has generated one for this season.
    Same trust/visibility reasoning as standings itself: every league
    member can see the bracket, not just the commissioner who
    generates/resolves it (POST /admin/playoffs/generate, /resolve)."""
    async with pool.acquire() as conn:
        nodes = await playoffs.get_bracket_view(conn, season, league_id)
    return {"season": season, "nodes": nodes}


@router.get("/seasons/{season}/playoffs/projected")
async def projected_playoff_picture(season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """"If the season ended today" — round 1's real seeded matchups,
    recomputed live from current standings on every request (see
    app/domain/playoffs.py's get_projected_playoff_picture). `matchups`
    is null once a real bracket has been generated (GET .../bracket
    above takes over from that point) or before there's enough real
    data to project from."""
    async with pool.acquire() as conn:
        matchups = await playoffs.get_projected_playoff_picture(conn, season, league_id)
    return {"season": season, "matchups": matchups}


@router.get("/seasons/{season}/waivers/priority")
async def waiver_priority(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """This week's real waiver order (this league's actual ESPN rule:
    resets each week to inverse order of standings — see app/domain/
    waivers.py) — visible to the whole league, same trust reasoning as
    standings itself, not just the team on top of it."""
    async with pool.acquire() as conn:
        order = await waivers.get_priority_order(conn, season, league_id, week)
    return {"week": week, "priority_order": order}


@router.get("/seasons/{season}/weeks/{week}/matchups")
async def week_matchups(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        rows = await queries.list_week_matchups(conn, season, week, league_id)
    return {"matchups": [dict(r) for r in rows]}


@router.get("/seasons/{season}/weeks/{week}/matchup-context")
async def week_matchup_context(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Everything the matchup expand-card needs for every matchup in the
    week, in one call — see app/domain/matchup_context.py."""
    async with pool.acquire() as conn:
        return await build_week_matchup_context(conn, season, week, league_id)


@router.get("/seasons/{season}/weeks/{week}/ticker")
async def week_ticker(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Lightweight feed for the league scores ticker (as opposed to
    /matchup-context, which is much heavier) — see
    app/domain/league_ticker.py."""
    async with pool.acquire() as conn:
        return await get_week_ticker_data(conn, season, week, league_id)


@router.get("/records")
async def record_book(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """All-time record book — top 3 per category, computed live on every
    request (see app/domain/records.py) so a new result shows up here
    the instant it's synced, not on some separate refresh cadence. Not
    season-scoped — spans the league's whole history."""
    async with pool.acquire() as conn:
        return await get_record_book(conn, league_id)


@router.get("/seasons/{season}/weeks/{week}/power-rankings")
async def week_power_rankings(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """This week's power rankings (with luck/SOS alongside, and
    movement vs. last week) — see app/domain/power_rankings.py."""
    async with pool.acquire() as conn:
        return {"rankings": await power_rankings.get_week_power_rankings(conn, season, week, league_id)}


@router.get("/seasons/{season}/power-rankings/latest-week")
async def latest_power_rankings_week(
    season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """The most recent week this season that actually has power rankings
    computed — lets the frontend default the "This Week" view to real
    data instead of guessing a week number that might not be synced yet."""
    async with pool.acquire() as conn:
        week = await power_rankings.get_latest_ranked_week(conn, season, league_id)
    return {"week": week}


@router.get("/seasons/{season}/power-rankings/trend")
async def season_power_rankings_trend(
    season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        return {"teams": await power_rankings.get_season_trend(conn, season, league_id)}


@router.get("/power-rankings/all-time")
async def all_time_power_rankings(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """All-time Power Rankings / Luck Index / Strength of Schedule
    leaderboards — same "computed live, not stored" convention as
    /records."""
    async with pool.acquire() as conn:
        return await power_rankings.get_all_time_indices(conn, league_id)


@router.get("/matchups/{matchup_id}")
async def matchup_detail(
    matchup_id: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Full matchup detail — box score, win probability, real head-to-
    head, rivalry, streaks, bench crime/clutch-choke callouts, and (once
    app/domain/narrative_engine.py is wired in) the write-up. Same
    per-matchup shape /seasons/{s}/weeks/{w}/matchup-context returns for
    one of its entries — see app/domain/matchup_context.py.

    build_matchup_detail resolves league_id from the matchup row itself
    (a matchup_id could in principle belong to a league other than the
    caller's), so the membership check below is against THAT resolved
    id, not blindly trusted from the URL — a matchup_id from a league
    the caller doesn't belong to 404s rather than leaking whether it
    exists."""
    async with pool.acquire() as conn:
        detail = await build_matchup_detail(conn, matchup_id)
    if detail is None or detail["league_id"] != league_id:
        raise HTTPException(status_code=404, detail="Matchup not found")
    return detail


@router.get("/teams/{team_id}")
async def team_detail(team_id: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        team = await queries.get_team(conn, team_id)
    if team is None or team["league_id"] != league_id:
        raise HTTPException(status_code=404, detail="Team not found")
    return dict(team)


@router.get("/teams/{team_id}/roster")
async def team_roster(
    team_id: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        team = await queries.get_team(conn, team_id)
        if team is None or team["league_id"] != league_id:
            raise HTTPException(status_code=404, detail="Team not found")
        rows = await queries.get_roster_for_week(conn, team["season"], team_id, week)
    return {"team": dict(team), "week": week, "roster": [dict(r) for r in rows]}


@router.get("/rivalries")
async def rivalries(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """rivalries has no league_id column yet (see app/queries/league.py's
    module docstring — missed by the Phase 3 season-scoped-table sweep
    since it isn't season-scoped), so this can only enforce "the caller
    belongs to SOME real league," not scope the specific rows to the
    caller's league the way every other endpoint here does. Not a live
    risk today (exactly one league has any rivalry data), but flagged
    here as a real follow-up once a second league actually has rivalries
    of its own — needs its own small migration."""
    async with pool.acquire() as conn:
        rows = await queries.list_rivalries(conn)
    return {"rivalries": [dict(r) for r in rows]}
