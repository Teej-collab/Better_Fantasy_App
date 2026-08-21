"""
Two independent scheduled jobs, both off by default so running the
backend locally doesn't silently start hitting ESPN and writing to
whatever DATABASE_URL happens to be configured:

- Full sync (ENABLE_ESPN_SYNC_SCHEDULER): the complete historical scan,
  replaces Fantasy_Helper's in-process discord.ext.tasks loop (see
  ARCHITECTURE.md). Meant for a slow cadence (default: daily).
- Live sync (ENABLE_LIVE_SYNC_SCHEDULER): re-syncs just the current
  week's matchups/rosters + boom/bust, fast enough to poll frequently
  during live games. Gated to whether a real NFL game is actually live
  right now (app/providers/nfl_scoreboard.py's is_nfl_game_live, backed
  by ESPN's own public scoreboard) so the *private, unofficial* fantasy
  API isn't polled around the clock for no reason — a deliberate
  decision, not an oversight (discussed with the project owner Aug 19
  2026). This replaced a day-of-week/hour heuristic (app/game_windows.py,
  removed Aug 20 2026) that could both miss a real game outside its
  fixed windows and false-positive on an empty evening inside them —
  see TODO.md. The public scoreboard check itself runs every tick
  regardless of day/time; it's a lightweight, unauthenticated, already
  widely-used-elsewhere endpoint, unlike the fantasy API this gate
  protects.
"""
import logging
import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.nfl_scoreboard import get_nfl_scoreboard, is_nfl_game_live
from app.providers.sync import run_full_sync, run_live_sync

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _run_full_sync_job():
    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    results = await run_full_sync(
        provider, espn_config.league_start_season, espn_config.active_season
    )
    logger.info("Scheduled full ESPN sync finished: %s", results)


async def _run_live_sync_job():
    games = await get_nfl_scoreboard()
    if not is_nfl_game_live(games):
        return

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    season = espn_config.active_season
    week = await provider.get_current_week(season)
    results = await run_live_sync(provider, season, week)
    logger.info("Live sync finished (season=%s week=%s): %s", season, week, results)


def start_scheduler():
    global _scheduler
    _scheduler = AsyncIOScheduler()
    started_any = False

    if os.getenv("ENABLE_ESPN_SYNC_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_hours = int(os.getenv("SYNC_INTERVAL_HOURS", "24"))
        _scheduler.add_job(_run_full_sync_job, "interval", hours=interval_hours, id="espn_full_sync")
        logger.info("Full ESPN sync scheduler started (every %d hours)", interval_hours)
        started_any = True

    if os.getenv("ENABLE_LIVE_SYNC_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_minutes = int(os.getenv("LIVE_SYNC_INTERVAL_MINUTES", "5"))
        _scheduler.add_job(_run_live_sync_job, "interval", minutes=interval_minutes, id="espn_live_sync")
        logger.info(
            "Live ESPN sync scheduler started (every %d minutes, only during NFL game windows)",
            interval_minutes,
        )
        started_any = True

    if started_any:
        _scheduler.start()
    else:
        _scheduler = None


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown()
        _scheduler = None
