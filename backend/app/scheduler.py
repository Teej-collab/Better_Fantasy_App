"""
Independent scheduled sync job — replaces Fantasy_Helper's in-process
discord.ext.tasks loop (see ARCHITECTURE.md: scheduling "should be
triggered by a proper scheduler... so it doesn't depend on a Discord bot
process being alive"). Runs inside the backend process via APScheduler.

Off by default (ENABLE_ESPN_SYNC_SCHEDULER unset) — running the backend
locally shouldn't silently start hitting ESPN and writing to whatever
DATABASE_URL happens to be configured. Turn it on deliberately once ESPN
sync has been confirmed working via the manual POST /admin/sync endpoint.
"""
import logging
import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.sync import run_full_sync

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _run_sync_job():
    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    results = await run_full_sync(
        provider, espn_config.league_start_season, espn_config.active_season
    )
    logger.info("Scheduled ESPN sync finished: %s", results)


def start_scheduler():
    global _scheduler
    if os.getenv("ENABLE_ESPN_SYNC_SCHEDULER", "").lower() not in ("1", "true", "yes"):
        return

    interval_hours = int(os.getenv("SYNC_INTERVAL_HOURS", "24"))
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_run_sync_job, "interval", hours=interval_hours, id="espn_sync")
    _scheduler.start()
    logger.info("ESPN sync scheduler started (every %d hours)", interval_hours)


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown()
        _scheduler = None
