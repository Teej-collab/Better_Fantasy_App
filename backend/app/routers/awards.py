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
from fastapi import APIRouter, Depends

from app.auth.league_context import require_league_access
from app.db import get_pool
from app.domain import awards_all_time, team_profile, weekly_awards
from app.queries import awards as awards_queries
from app.queries import league as league_queries

router = APIRouter(tags=["awards"])


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


@router.get("/awards/all-time")
async def all_time_awards(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        return await awards_all_time.get_award_leaderboards(conn, league_id)


@router.get("/seasons/{season}/weeks/{week}/awards")
async def weekly_awards_endpoint(
    season: int, week: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
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
