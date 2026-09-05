"""
Three independent scheduled jobs, all off by default so running the
backend locally doesn't silently start hitting ESPN/a live-game
provider and writing to whatever DATABASE_URL happens to be configured:

- Full sync (ENABLE_ESPN_SYNC_SCHEDULER): the complete historical scan,
  replaces Fantasy_Helper's in-process discord.ext.tasks loop (see
  ARCHITECTURE.md). Meant for a slow cadence (default: daily). Also
  starts a second job on the same flag/interval — the bulk ESPN
  projected-points sync for the draft pool (app/domain/
  player_projections.py) — since it's the same kind of slow-changing
  seasonal ESPN data this flag already exists for, not a reason to
  invent a second flag.
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
- Keeper auto-lock (ENABLE_KEEPER_LOCK_SCHEDULER): every 60 seconds,
  locks any league's keeper selections (league_keeper_rules.locked_at,
  same as a commissioner's manual "Lock keepers" click) once that
  league's own real draft is within 1 hour of its scheduled_start —
  previously manual-only. Same "must be turned on before the real
  draft date" note as the draft clock above.
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

from app.config import _require
from app.db import get_pool
from app.domain import draft_engine, weekly_stats
from app.domain.draft_exceptions import DraftError
from app.domain.player_projections import sync_projected_points
from app.draft.manager import manager as draft_manager
from app.gamecast import service as gamecast_service
from app.notifications import fantasy_events
from app.notifications.draft_events import notify_draft_starting_soon, notify_on_the_clock
from app.gamecast.manager import manager as gamecast_manager
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.nfl_scoreboard import get_nfl_scoreboard, is_nfl_game_live
from app.providers.sleeper.ingest import sync_players
from app.providers.sync import run_full_sync, run_live_sync
from app.queries import keepers as keeper_queries
from app.scheduler_status import record_job_run

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _run_full_sync_job():
    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    results = await run_full_sync(
        provider, espn_config.league_start_season, espn_config.active_season
    )
    logger.info("Scheduled full ESPN sync finished: %s", results)
    record_job_run("full_sync")


async def _run_live_sync_job():
    games = await get_nfl_scoreboard()
    if not is_nfl_game_live(games):
        return

    espn_config = ESPNConfig()
    provider = ESPNProvider(espn_config)
    season = espn_config.active_season
    week = await provider.get_current_week(season)

    pool = await get_pool()
    async with pool.acquire() as conn:
        before = await fantasy_events.snapshot_week(conn, season, week)

    results = await run_live_sync(provider, season, week)
    logger.info("Live sync finished (season=%s week=%s): %s", season, week, results)

    # Diffed against the snapshot above, not derived from `results`
    # (a per-step success/failure summary, not the actual numbers) —
    # see app/notifications/fantasy_events.py's own docstring for why
    # this watches the same real numbers My Team/Matchups already show
    # rather than Gamecast's play-by-play (no fantasy-roster
    # attribution of its own).
    async with pool.acquire() as conn:
        after = await fantasy_events.snapshot_week(conn, season, week)
        await fantasy_events.notify_fantasy_events(conn, season, before, after)
    record_job_run("live_sync")


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
    record_job_run("sleeper_player_sync")


async def _run_projected_points_sync_job():
    """Bulk ESPN projected-points sync for the draft pool's inline
    stats (app/domain/player_projections.py) — gated on the same
    ENABLE_ESPN_SYNC_SCHEDULER flag as the full sync above rather than
    its own flag, since this is the same kind of slow-changing seasonal
    ESPN data that job already exists for, just a separate call (a
    League.free_agents() bulk read, not part of run_full_sync's own
    matchup/roster sync)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        results = await sync_projected_points(conn)
    logger.info("Player projections sync finished: %s", results)
    record_job_run("projected_points_sync")


async def _run_draft_clock_job():
    """Every league with its own in-progress, past-deadline draft gets
    autopicked independently — not just League #1 (see TODO.md's PHASE
    9 entry, "session-resolved active league"). draft.py's WebSocket
    room key is (season, league_id), same reasoning as
    app/draft/manager.py's own docstring: two leagues drafting the same
    real season are two separate rooms, so a tick here can never
    autopick or broadcast into the wrong one."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            "SELECT league_id FROM draft_config "
            "WHERE season = $1 AND status = 'in_progress' AND current_pick_deadline IS NOT NULL "
            "AND current_pick_deadline <= $2",
            season, datetime.now(timezone.utc),
        )
        for row in due:
            league_id = row["league_id"]
            try:
                result = await draft_engine.autopick(conn, season, league_id=league_id)
            except DraftError:
                logger.exception("Draft autopick failed for season=%s league_id=%s", season, league_id)
                continue
            await draft_manager.broadcast_to_draft((season, league_id), {"type": "pick_made", **result})
            await notify_on_the_clock(season, league_id, result["config"])
            logger.info(
                "Draft autopick: season=%s league_id=%s pick=%s", season, league_id, result["pick"]["pick_number"]
            )


async def _run_keeper_lock_job():
    """Auto-locks any league's keeper window once its real draft is
    within 1 hour of its own scheduled_start (draft_config.scheduled_start,
    set via PUT /draft/schedule) — before this, locking was manual-only
    (league_keeper_rules.locked_at, previously only ever set by a
    commissioner's own "Lock keepers" click, see queries/keepers.py's
    lock_rules). Every league with real keeper rules gets checked
    independently, same "not just League #1" shape as
    _run_draft_clock_job above. "Uses keepers" means max_keepers > 0 —
    there's no separate per-league flag for this (see
    league_keeper_rules' own schema); a league with no rules row, or
    max_keepers = 0, is simply never selected by this query. lock_rules
    is already idempotent (a no-op once locked_at is set), so a league
    that crosses the threshold gets picked up and locked exactly once
    even though this job re-checks on every tick."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            """
            SELECT lkr.league_id
            FROM league_keeper_rules lkr
            JOIN draft_config dc ON dc.season = lkr.season AND dc.league_id = lkr.league_id
            WHERE lkr.season = $1
              AND lkr.max_keepers > 0
              AND lkr.locked_at IS NULL
              AND dc.scheduled_start IS NOT NULL
              AND dc.scheduled_start - interval '1 hour' <= $2
            """,
            season, datetime.now(timezone.utc),
        )
        for row in due:
            league_id = row["league_id"]
            locked = await keeper_queries.lock_rules(conn, season, league_id=league_id)
            if locked is not None:
                logger.info("Keeper auto-lock: season=%s league_id=%s", season, league_id)


async def _run_draft_starting_soon_job():
    """Pushes every real drafting owner once, ~15 minutes before their
    league's real draft (draft_config.scheduled_start, PUT /draft/
    schedule) — only ever fires for a draft that hasn't started yet, and
    only once per draft: starting_soon_notified_at is the idempotency
    flag (see its own migration), set right after the push goes out, so
    a league that crosses the threshold gets notified exactly once even
    though this job re-checks on every tick — same shape as
    _run_keeper_lock_job above, just without a natural DB state change
    of its own to key off. The window itself (scheduled_start between
    now and 15 minutes from now) means a league whose reminder job was
    down through the whole window silently misses it rather than
    firing a stale "starting soon" push for a draft that already
    started — an acceptable trade for staying simple."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            """
            SELECT league_id FROM draft_config
            WHERE season = $1 AND status = 'not_started' AND starting_soon_notified_at IS NULL
              AND scheduled_start IS NOT NULL
              AND scheduled_start BETWEEN $2 AND $2 + interval '15 minutes'
            """,
            season, datetime.now(timezone.utc),
        )
        for row in due:
            league_id = row["league_id"]
            owner_rows = await conn.fetch(
                "SELECT DISTINCT owner_id FROM draft_picks WHERE season = $1 AND league_id = $2",
                season, league_id,
            )
            owner_ids = [r["owner_id"] for r in owner_rows]
            await notify_draft_starting_soon(season, league_id, owner_ids, minutes=15)
            await conn.execute(
                "UPDATE draft_config SET starting_soon_notified_at = now() WHERE season = $1 AND league_id = $2",
                season, league_id,
            )
            logger.info("Draft starting-soon reminder sent: season=%s league_id=%s", season, league_id)


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
    record_job_run("weekly_compute")


def start_scheduler():
    global _scheduler
    _scheduler = AsyncIOScheduler()
    started_any = False

    if os.getenv("ENABLE_ESPN_SYNC_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_hours = int(os.getenv("SYNC_INTERVAL_HOURS", "24"))
        _scheduler.add_job(_run_full_sync_job, "interval", hours=interval_hours, id="espn_full_sync")
        logger.info("Full ESPN sync scheduler started (every %d hours)", interval_hours)
        _scheduler.add_job(
            _run_projected_points_sync_job, "interval", hours=interval_hours, id="espn_projected_points_sync"
        )
        logger.info("ESPN projected-points sync scheduler started (every %d hours)", interval_hours)
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
        # Same enable flag as the clock above — both are "is the draft
        # system live" concerns, not worth a second env var for the
        # commissioner to remember to set.
        _scheduler.add_job(_run_draft_starting_soon_job, "interval", seconds=60, id="draft_starting_soon")
        logger.info("Draft starting-soon reminder scheduler started (every 60 seconds)")
        started_any = True

    if os.getenv("ENABLE_KEEPER_LOCK_SCHEDULER", "").lower() in ("1", "true", "yes"):
        _scheduler.add_job(_run_keeper_lock_job, "interval", seconds=60, id="keeper_lock")
        logger.info("Keeper auto-lock scheduler started (every 60 seconds)")
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
