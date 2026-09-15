"""
Season + weekly awards — ports of Fantasy_Helper's
bot/awards_engine/season_awards.py (the determined results, already
computed into the season_awards table) and weekly_awards.py (computed
live here, same as the original). See app/domain/weekly_awards.py and
MIGRATION_MAP.md.

Every endpoint requires real active-league membership (require_league_access)
— this used to be fully public, no auth at all, a real confirmed
vulnerability alongside league.py's/profile.py's (see league.py's module
docstring and app/auth/league_context.py's require_league_access for the
full story).
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.league_context import require_league_access, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool
from app.domain import awards_all_time, narrative_engine, team_profile, weekly_awards
from app.domain.draft_grades import get_draft_grade, get_draft_grades_for_season
from app.domain.draft_narratives import get_draft_narrative
from app.providers.nfl_scoreboard import get_week_scoreboard, is_week_final
from app.queries import awards as awards_queries
from app.queries import draft as draft_queries
from app.queries import league as league_queries

router = APIRouter(tags=["awards"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


@router.get("/seasons/{season}/awards")
async def season_awards(
    season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        champion = await awards_queries.get_season_champion(conn, season, league_id)
        awards = await awards_queries.list_season_awards(conn, season, league_id)
    return {
        "champion": dict(champion) if champion is not None else None,
        "awards": [dict(a) for a in awards],
    }


@router.get("/seasons/{season}/draft-grades")
async def season_draft_grades(
    season: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Real, completed-draft data for a past OR the active season — every
    existing /draft/* endpoint hardcodes the live ACTIVE_SEASON (built
    for "the one live draft happening right now"), so viewing any other
    season's draft needs this separate, season-parameterized route.
    Grades/narratives are computed by a scheduler job shortly after a
    draft completes (app/scheduler.py's _run_draft_grades_job) — both
    come back empty (not an error) for a season whose draft hasn't
    finished yet, or whose grades haven't been computed on the next
    tick yet."""
    async with pool.acquire() as conn:
        state = await draft_queries.get_draft_state(conn, season, league_id)
        if state is None:
            raise HTTPException(status_code=404, detail="No draft found for this season")
        grades = await get_draft_grades_for_season(conn, season, league_id)
        narratives = {
            g["owner_id"]: await get_draft_narrative(conn, season, g["owner_id"], league_id) for g in grades
        }
    return {
        "config": state["config"],
        "picks": state["picks"],
        "grades": [dict(g) for g in grades],
        "narratives": narratives,
    }


@router.get("/seasons/{season}/owners/{owner_id}/draft-grade")
async def owner_draft_grade(
    season: int, owner_id: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    async with pool.acquire() as conn:
        grade = await get_draft_grade(conn, season, owner_id, league_id)
        if grade is None:
            return {"grade": None, "narrative": None}
        narrative = await get_draft_narrative(conn, season, owner_id, league_id)
    return {"grade": dict(grade), "narrative": narrative}


@router.get("/awards/all-time")
async def all_time_awards(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        return await awards_all_time.get_award_leaderboards(conn, league_id)


@router.get("/seasons/{season}/weeks/{week}/awards")
async def weekly_awards_endpoint(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    # 2026-09-09 fix: biggest_bench_crime/clutch/choke/boom_bust/
    # game_of_the_week each independently query their own underlying
    # table (bench_crimes, roster_history, matchups) with no "is this
    # week actually over" check of their own — every one of them was
    # capable of "awarding" off a live, in-progress week the moment any
    # stat existed (real incident, Week 1 2026 kickoff, minutes after
    # real kickoff). Same real signal as get_standings/
    # weekly_awards._load_week_context: this week's real NFL slate has
    # to have actually finished. Short-circuits to the same empty shape
    # a genuinely-not-yet-played future week already returns, rather
    # than patching each of the five functions below individually.
    games = await get_week_scoreboard(week=week, year=season)
    if not is_week_final(games):
        return {
            "overachiever": None,
            "meltdown": None,
            "biggest_bench_crime": None,
            "clutch": None,
            "choke": None,
            "boom_leaders": [],
            "bust_leaders": [],
            "game_of_the_week": None,
        }

    async with pool.acquire() as conn:
        matchups = await league_queries.list_week_matchups(conn, season, week, league_id)
        matchups = [dict(m) for m in matchups]

        overachiever, meltdown = await weekly_awards.get_overachiever_and_meltdown(conn, season, week, league_id)
        bench_crime = await weekly_awards.get_biggest_bench_crime(conn, season, week, league_id)
        clutch, choke = await weekly_awards.get_clutch_choke_of_week(conn, season, week, league_id)
        booms, busts = await weekly_awards.get_boom_bust_leaders(conn, season, week, league_id=league_id)

        game_of_week_matchup = await team_profile.find_game_of_the_week(conn, season, week, matchups)
        game_of_week = await weekly_awards.get_game_of_week_result(
            conn, season, week, game_of_week_matchup, league_id
        )

    return {
        "overachiever": overachiever,
        "meltdown": meltdown,
        "biggest_bench_crime": bench_crime,
        "clutch": clutch,
        "choke": choke,
        "boom_leaders": booms,
        "bust_leaders": busts,
        "game_of_the_week": game_of_week,
    }


@router.get("/seasons/{season}/weeks/{week}/recap")
async def weekly_recap(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Cache-only read of the whole-week narrative — same reasoning as
    narrative_engine.get_cached_weekly_narrative's own docstring, this
    must never trigger a live generation on a plain page view. `null`
    text means nothing's been generated yet (or nothing's eligible
    yet); see the POST below for the commissioner-only action that
    actually generates it."""
    async with pool.acquire() as conn:
        narrative = await narrative_engine.get_cached_weekly_narrative(conn, season, week, league_id)
    return {"narrative": narrative}


@router.post("/seasons/{season}/weeks/{week}/recap/generate")
async def generate_weekly_recap(
    season: int, week: int, request: Request, force: bool = False, pool=Depends(get_pool)
):
    """Commissioner-only, deliberate bulk action: fills in every real
    matchup's own narrative for the week plus the new whole-week
    narrative in one request, instead of relying on lazy one-at-a-time
    generation as visitors happen to click into matchups. See
    narrative_engine.generate_weekly_recap's own docstring for why this
    has to be an explicit action rather than automatic.

    `force` (query param, default false): skips the whole-week cache
    read so a real regeneration happens even when one's already cached
    — WeekRecapSection.tsx's "Regenerate" button (as opposed to its
    first-time "Generate" label) passes this, since without it the
    button was a no-op on an already-cached week (2026-09-15 fix)."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        result = await narrative_engine.generate_weekly_recap(conn, season, week, league_id, force=force)
    return result
