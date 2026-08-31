"""
Three independent scheduled jobs, all off by default so running the
backend locally doesn't silently start hitting ESPN/a live-game
provider and writing to whatever DATABASE_URL happens to be configured:

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
- Gamecast (ENABLE_GAMECAST_SCHEDULER): polls the configured live-NFL-
  game provider (Sportradar, or the mock simulation — see app/gamecast/
  providers/__init__.py) for every currently-subscribed game, updates
  the in-memory live-game cache, and pushes the result over WebSocket
  to anyone watching. Same is_nfl_game_live gate as live sync, plus its
  own inner check — only games someone's actually connected to
  (GamecastConnectionManager.live_game_ids()) get polled, not the
  provider's entire live slate, so an idle Gamecast feature with zero
  viewers costs nothing beyond the one lightweight scoreboard check
  every tick.
- Sleeper player sync (ENABLE_SLEEPER_PLAYER_SYNC_SCHEDULER): refreshes
  the `players` table from Sleeper's free player API once a day —
  Sleeper's own docs require at most one pull a day, so this interval
  is a hard ceiling, not a tuning knob (see app/providers/sleeper/
  client.py). There's also a manual POST /admin/players/sync trigger
  for the first-ever ingestion so it doesn't have to wait on a cron
  tick.
- Draft clock (ENABLE_DRAFT_CLOCK_SCHEDULER): every tick, autopicks any
  team whose pick_time_limit has expired with no pick made and
  broadcasts the result over the draft WebSocket (app/draft/manager.py).
  A tight 2-second interval, not 60s/24h like the sync jobs above — a
  countdown clock hitting zero needs to feel immediate during a live
  draft. This must be turned on in production well before the real
  draft date; it defaults off like everything else here.
- Weekly compute (ENABLE_WEEKLY_COMPUTE_SCHEDULER): this app's own
  Phase D/F scoring — app/domain/weekly_stats.py's
  compute_and_store_week() — recomputing every rostered player's real
  fantasy points and every matchup's score for the active week. Same
  is_nfl_game_live gate as live sync (no point recomputing points
  between games), same reasoning for why: cheap enough to poll
  during live games but real work, not run around the clock for no
  reason. Independent of ENABLE_LIVE_SYNC_SCHEDULER — that job still
  refreshes ESPN's own schedule/pairing data (matchups.sync_matchups,
  rosters snapshot); this one is what actually turns raw NFL stats
  into this league's fantasy points now that scoring is computed
  in-app instead of copied from ESPN. There's also a manual
  POST /admin/weekly-compute trigger, matching /admin/sync/live's
  pattern, for testing without waiting on a live game.
"""
import logging
import os
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import DEFAULT_LEAGUE_ID, _require
from app.db import get_pool
from app.domain import draft_engine, weekly_stats
from app.domain.draft_exceptions import DraftError
from app.draft.manager import manager as draft_manager
from app.gamecast import service as gamecast_service
from app.gamecast.manager import manager as gamecast_manager
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.nfl_scoreboard import get_nfl_scoreboard, is_nfl_game_live
from app.providers.sleeper.ingest import sync_players
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


async def _run_gamecast_poll_job():
    games = await get_nfl_scoreboard()
    if not is_nfl_game_live(games):
        return

    game_ids = gamecast_manager.live_game_ids()
    if not game_ids:
        return  # nobody's actually watching a Gamecast right now

    pool = await get_pool()
    for game_id in game_ids:
        async with pool.acquire() as conn:
            try:
                game, fantasy_events = await gamecast_service.refresh_game(conn, game_id)
            except Exception:
                logger.exception("Gamecast poll failed for game_id=%s", game_id)
                continue
        await gamecast_manager.broadcast_to_game(game_id, {"type": "game_state", "game": game.model_dump(mode="json")})
        for event in fantasy_events:
            await gamecast_manager.broadcast_to_game(game_id, event)
    logger.info("Gamecast poll finished for %d live game(s)", len(game_ids))


async def _run_sleeper_player_sync_job():
    count = await sync_players(await get_pool())
    logger.info("Sleeper player sync finished: %d players upserted", count)


async def _run_draft_clock_job():
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        config = await conn.fetchrow(
            "SELECT status, current_pick_deadline FROM draft_config WHERE season = $1 AND league_id = $2",
            season, DEFAULT_LEAGUE_ID,
        )
        if config is None or config["status"] != "in_progress" or config["current_pick_deadline"] is None:
            return
        if config["current_pick_deadline"] > datetime.now(timezone.utc):
            return
        try:
            result = await draft_engine.autopick(conn, season)
        except DraftError:
            logger.exception("Draft autopick failed for season=%s", season)
            return
    await draft_manager.broadcast_to_draft(season, {"type": "pick_made", **result})
    logger.info("Draft autopick: season=%s pick=%s", season, result["pick"]["pick_number"])


async def _run_weekly_compute_job():
    games = await get_nfl_scoreboard()
    if not is_nfl_game_live(games):
        return

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    season = espn_config.active_season
    week = await provider.get_current_week(season)
    results = await weekly_stats.compute_and_store_week(await get_pool(), season, week)
    logger.info("Weekly compute finished (season=%s week=%s): %s", season, week, results)


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
        # Seconds, not minutes — was LIVE_SYNC_INTERVAL_MINUTES (default
        # 5 min) until the project owner asked for fantasy points to
        # track a live touchdown much closer to real time. 60s is a
        # meaningfully faster cadence against ESPN's undocumented
        # private fantasy API while still being a safe rate for a
        # single small league (not polled at all outside a live game
        # window either way — see is_nfl_game_live above).
        interval_seconds = int(os.getenv("LIVE_SYNC_INTERVAL_SECONDS", "60"))
        _scheduler.add_job(_run_live_sync_job, "interval", seconds=interval_seconds, id="espn_live_sync")
        logger.info(
            "Live ESPN sync scheduler started (every %d seconds, only during NFL game windows)",
            interval_seconds,
        )
        started_any = True

    if os.getenv("ENABLE_GAMECAST_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_seconds = int(os.getenv("GAMECAST_POLL_INTERVAL_SECONDS", "4"))
        _scheduler.add_job(_run_gamecast_poll_job, "interval", seconds=interval_seconds, id="gamecast_poll")
        logger.info(
            "Gamecast poll scheduler started (every %d seconds, only during NFL game windows with active viewers)",
            interval_seconds,
        )
        started_any = True

    if os.getenv("ENABLE_SLEEPER_PLAYER_SYNC_SCHEDULER", "").lower() in ("1", "true", "yes"):
        _scheduler.add_job(_run_sleeper_player_sync_job, "interval", hours=24, id="sleeper_player_sync")
        logger.info("Sleeper player sync scheduler started (every 24 hours)")
        started_any = True

    if os.getenv("ENABLE_DRAFT_CLOCK_SCHEDULER", "").lower() in ("1", "true", "yes"):
        _scheduler.add_job(_run_draft_clock_job, "interval", seconds=2, id="draft_clock")
        logger.info("Draft clock scheduler started (every 2 seconds)")
        started_any = True

    if os.getenv("ENABLE_WEEKLY_COMPUTE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_seconds = int(os.getenv("WEEKLY_COMPUTE_INTERVAL_SECONDS", "120"))
        _scheduler.add_job(_run_weekly_compute_job, "interval", seconds=interval_seconds, id="weekly_compute")
        logger.info(
            "Weekly compute scheduler started (every %d seconds, only during NFL game windows)",
            interval_seconds,
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
