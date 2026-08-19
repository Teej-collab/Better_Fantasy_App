"""
Runs teams/matchups/rosters sync across every season for a given
provider, tolerating partial failure the same way Fantasy_Helper's
refresh_pipeline.py does — one bad season or step doesn't block the rest,
and the caller gets a full picture of what succeeded.

Stats-engine computation isn't ported yet (that's Phase 6), so this only
covers ingestion, not the full pipeline refresh_pipeline.py orchestrated.
"""
from app.db import get_pool
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
            ("final_standings", provider.sync_final_standings),
        ):
            try:
                count = await step(pool, season)
                season_results[step_name] = {"status": "success", "count": count}
            except Exception as e:
                season_results[step_name] = {"status": "failed", "detail": str(e)}
        results[season] = season_results

    return results
