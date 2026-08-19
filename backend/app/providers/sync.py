"""
Runs teams/matchups/rosters sync across every season for a given
provider, tolerating partial failure the same way Fantasy_Helper's
refresh_pipeline.py does — one bad season or step doesn't block the rest,
and the caller gets a full picture of what succeeded.

boom_bust is a derived-stats compute step (not an ESPN fetch — it reads
whatever's already synced into `rosters`), included here so it stays
live: every full/live sync recomputes it for that season's actual roster
data. Other compute_*.py-equivalents (luck, chaos, power rank, bench
crimes, awards) haven't been ported yet — see TODO.md's Phase 6 "who
computes this going forward" note.
"""
from app.db import get_pool
from app.domain.boom_bust import compute_boom_bust_for_season, compute_boom_bust_for_single_week
from app.providers.base import FantasyProvider


async def run_full_sync(provider: FantasyProvider, start_season: int, end_season: int) -> dict:
    pool = await get_pool()
    results = {}

    for season in range(start_season, end_season + 1):
        season_results = {}
        for step_name, step in (
            ("teams", provider.sync_teams),
            ("matchups", provider.sync_matchups),
            ("rosters", provider.sync_rosters),
            ("boom_bust", compute_boom_bust_for_season),
            ("final_standings", provider.sync_final_standings),
        ):
            try:
                count = await step(pool, season)
                season_results[step_name] = {"status": "success", "count": count}
            except Exception as e:
                season_results[step_name] = {"status": "failed", "detail": str(e)}
        results[season] = season_results

    return results


async def run_live_sync(provider: FantasyProvider, season: int, week: int) -> dict:
    """Fast path for in-game updates: re-syncs one specific week's
    matchups and rosters (not a full season scan) and recomputes
    boom/bust for just that week. Cheap enough to poll frequently during
    live games — see app/scheduler.py's live-sync job."""
    pool = await get_pool()
    results = {}

    for step_name, step in (
        ("matchups", lambda p, s: provider.sync_matchups_for_week(p, s, week)),
        ("rosters", lambda p, s: provider.sync_rosters_for_week(p, s, week)),
        ("boom_bust", lambda p, s: compute_boom_bust_for_single_week(p, s, week)),
    ):
        try:
            count = await step(pool, season)
            results[step_name] = {"status": "success", "count": count}
        except Exception as e:
            results[step_name] = {"status": "failed", "detail": str(e)}

    return results
