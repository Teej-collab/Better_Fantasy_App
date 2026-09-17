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
- Week settlement (ENABLE_WEEK_SETTLEMENT_SCHEDULER, 2026-09): the one
  job in this file that runs regardless of is_nfl_game_live — every
  other week-scoped job here goes completely dark the instant the last
  live game of the week ends, leaving chug debts, the chug countdown,
  and the weekly recap's own eligibility all depending on the once-
  daily full sync to eventually catch up (previously up to 24h, at an
  unpredictable time). Polls the same free, public NFL scoreboard call
  every few minutes all week, checking the CACHED current week's own
  real game data directly rather than waiting on ESPN's own separate
  week.number counter to roll over (real report, same day: that
  counter can lag real completion by a long stretch) — the real
  settlement work (chug debts, the Monday-deadline doubling, and
  auto-generating the now-eligible weekly recap) only actually fires
  once per real week rollover, and this job then advances
  league_state.current_week itself — see _run_week_settlement_job's
  own docstring.
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
- Watch Party (ENABLE_WATCH_PARTY_SCHEDULER): a sibling of Gamecast
  above, not a shared job — pushes the "fantasy digest" (close/live
  league matchups, see app/domain/watch_party.py) to everyone connected
  to a Watch Party room's WebSocket. Same is_nfl_game_live gate plus its
  own "only rooms someone's actually in" check
  (WatchPartyConnectionManager.live_room_ids()). Runs on its own, more
  relaxed default interval than Gamecast's 4s — real fantasy scores only
  change as fast as live sync itself runs (60s default), so polling
  faster than that would just recompute identical numbers.
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
  draft date; it defaults off like everything else here. Same flag also
  starts draft-starting-soon reminders and draft auto-start (below) —
  all three are "is the draft system live" concerns, not worth separate
  env vars.
- Draft auto-start (same ENABLE_DRAFT_CLOCK_SCHEDULER flag, 2026-09):
  flips a draft from 'not_started' to 'in_progress' on its own once the
  real clock reaches draft_config.scheduled_start — the "pre-draft room"
  feature's server-authoritative live transition, so the room goes live
  on time even if the commissioner never clicks "Start Draft" manually.
  Same 2-second tick as the pick clock, for the same "should feel
  immediate" reason. Relies on start_draft()'s own guard against being
  called twice (app/domain/draft_engine.py) so this can never race a
  commissioner's own manual start into rewinding the draft.
- Draft room open (same ENABLE_DRAFT_CLOCK_SCHEDULER flag, 2026-09):
  every 60 seconds, pushes every real drafting owner once, the moment
  the pre-draft room opens (scheduled_start minus the room's own
  1-hour window). draft_config.room_opened_notified_at is the
  idempotency flag, same pattern as starting_soon_notified_at.
- Keeper auto-lock (ENABLE_KEEPER_LOCK_SCHEDULER): every 60 seconds,
  locks any league's keeper selections (league_keeper_rules.locked_at,
  same as a commissioner's manual "Lock keepers" click) once that
  league's own real draft is within 1 hour of its scheduled_start —
  previously manual-only. Same "must be turned on before the real
  draft date" note as the draft clock above.
- Keeper deadline warning (same ENABLE_KEEPER_LOCK_SCHEDULER flag,
  2026-09): every 60 seconds, pushes every real drafting owner once,
  ~30 minutes before their league's keeper selection deadline.
  league_keeper_rules.deadline_warning_notified_at is the idempotency
  flag, same pattern as room_opened_notified_at above.
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
  pattern, for testing without waiting on a live game. Immediately
  after each real compute, also checks app/domain/playoffs.py's
  resolve_ready_playoff_matchups (best-effort, same flag) — the
  natural moment to see whether a just-scored week completes some
  playoff bracket node, now that the bracket itself is generated
  in-app (app/domain/playoffs.py) instead of read from ESPN.
- Waiver processing (ENABLE_WAIVER_PROCESSING_SCHEDULER): resolves this
  league's real 1-day waiver period (app/domain/waivers.py, matching
  the commissioner's actual ESPN settings — priority-order waivers,
  not FAAB, resetting each week to inverse standings) — every player
  whose waiver_wire clock has run out gets its pending claims processed
  and leaves the wire either way, whether a claim won or there were
  none at all. Runs hourly by default (WAIVER_PROCESSING_INTERVAL_
  SECONDS), not once daily like a real platform's overnight batch —
  keeps an actual drop-to-clear gap close to the real "1 Day" setting
  regardless of what time of day the drop happened, rather than adding
  up to 24h of extra delay waiting for one fixed nightly slot. Loops
  over every league with an expired waiver_wire row, same "not just
  League #1" shape as the keeper/draft-clock jobs above.
"""
import logging
import os
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import _require
from app.db import get_pool
from app.domain import draft_engine, narrative_engine, weekly_stats
from app.domain import watch_party as watch_party_domain
from app.domain.chug_debt import compute_chug_debts_for_single_week
from app.domain.chug_standing import accrue_weekly_debt_for_single_week, ensure_chug_deadline_settled
from app.domain.draft_exceptions import DraftError
from app.domain.draft_grades import compute_draft_grades
from app.domain.draft_narratives import generate_draft_narratives
from app.domain.player_projections import sync_projected_points
from app.draft.manager import manager as draft_manager
from app.gamecast import service as gamecast_service
from app.notifications import fantasy_events
from app.notifications.draft_events import (
    notify_draft_live,
    notify_draft_room_open,
    notify_draft_starting_soon,
    notify_keeper_deadline_approaching,
    notify_on_the_clock,
)
from app.gamecast.manager import manager as gamecast_manager
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.nfl_scoreboard import get_nfl_scoreboard, get_real_current_week, get_week_scoreboard, is_nfl_game_live
from app.providers.sleeper.ingest import sync_players
from app.providers.sync import run_full_sync, run_live_sync, update_league_state
from app.domain import waivers
from app.domain.playoffs import resolve_ready_playoff_matchups
from app.queries import keepers as keeper_queries
from app.queries import league as league_queries
from app.queries import watch_party as watch_party_queries
from app.scheduler_status import record_job_run
from app.watch_party.manager import manager as watch_party_manager

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
    week = await get_real_current_week()
    if week is None:
        return

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


async def _run_week_settlement_job():
    """Catches a week actually finishing the moment it happens,
    independent of is_nfl_game_live — real report (2026-09): chug
    debts, the chug countdown, and the weekly recap's own eligibility
    all only finalize once a week is genuinely over, but every OTHER
    job that would refresh/settle that state (live sync above, weekly
    compute below) is gated to run only while a real NFL game is live
    somewhere. The instant Monday Night Football's last game ends,
    those jobs go dark until Thursday's next kickoff.

    Deliberately does NOT decide "is this week over" from
    get_real_current_week() (ESPN's public scoreboard's own week.number
    field) the way this job originally did — real report, same day:
    that field kept reading Week 1 for a long stretch after every
    single Week 1 game had already gone Final, so a rollover-based
    check never fired at all. Instead this checks the CACHED week's own
    real game data directly (the same is_week_final signal
    app/domain/chug_debt.py and narrative_engine.py's own
    _week_completion already rely on) and advances league_state.
    current_week itself the moment that's true — never waiting on
    ESPN's separate counter to agree. update_league_state's own
    GREATEST(...) upsert (app/providers/sync.py) means this can never
    be regressed back down by run_full_sync's once-a-day tick or a
    live-sync tick later calling it with that other, possibly-stale
    value.

    Cheap enough to run often regardless of day/time: get_week_scoreboard
    is the same lightweight, public, keyless NFL scoreboard call every
    other gate here already treats as free. The real (DB-writing,
    LLM-calling) settlement work below only actually runs once per
    rollover — once league_state.current_week has been advanced past a
    week, this job stops re-checking that week's game data at all on
    later ticks (it only ever looks at the CURRENTLY cached week).
    """
    espn_config = ESPNConfig()
    season = espn_config.active_season

    pool = await get_pool()
    async with pool.acquire() as conn:
        cached_week = await league_queries.get_cached_current_week(conn, season)

    if cached_week is None:
        # Nothing synced yet at all for this season — fall back to
        # ESPN's own real counter, same first-ever-boot fallback every
        # other job in this file already uses.
        real_week = await get_real_current_week()
        if real_week is not None:
            await update_league_state(pool, season, real_week)
        return

    settle_week = cached_week
    week_games = await get_week_scoreboard(week=settle_week, year=season)
    week_is_final = bool(week_games) and all(g.get("completed") for g in week_games)
    if not week_is_final:
        return

    async with pool.acquire() as conn:
        league_rows = await conn.fetch(
            "SELECT DISTINCT league_id FROM teams_by_season WHERE season = $1 ORDER BY league_id",
            season,
        )

    for row in league_rows:
        league_id = row["league_id"]
        try:
            await compute_chug_debts_for_single_week(pool, season, settle_week, league_id)
            await accrue_weekly_debt_for_single_week(pool, season, settle_week, league_id)
            await ensure_chug_deadline_settled(pool, season, settle_week, week_games, league_id=league_id)
            # Idempotent — checks the cache before ever calling the real
            # Anthropic API (see narrative_engine.py), so this is a fast
            # no-op on every tick after the first successful generation,
            # never a second real LLM call or cost.
            async with pool.acquire() as conn:
                await narrative_engine.generate_weekly_recap(conn, season, settle_week, league_id)
            logger.info(
                "Week settlement finished (season=%s week=%s league_id=%s)", season, settle_week, league_id
            )
        except Exception:
            logger.exception(
                "Week settlement failed (season=%s week=%s league_id=%s)", season, settle_week, league_id
            )
            continue

    # Only advance our own pointer once settle_week is confirmed done —
    # the NEXT tick re-checks whatever week is cached now the same way,
    # so it keeps advancing one real week at a time as each one actually
    # finishes, never more than one rollover ahead of real completion.
    await update_league_state(pool, season, settle_week + 1)

    record_job_run("week_settlement")


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


async def _run_watch_party_poll_job():
    """A sibling of _run_gamecast_poll_job above, not a shared loop
    body — this iterates room_ids (watch_party_manager), not game_ids
    (gamecast_manager), and its data source is the fantasy digest built
    from matchup_context (app/domain/watch_party.py), not a per-NFL-
    game refresh. Real fantasy scores only ever change as fast as the
    live ESPN sync job itself runs (LIVE_SYNC_INTERVAL_SECONDS, default
    60s) — polling this faster than that would just recompute the same
    numbers, so this has its own, more relaxed default interval rather
    than reusing Gamecast's 4s one."""
    games = await get_nfl_scoreboard()
    if not is_nfl_game_live(games):
        return

    room_ids = watch_party_manager.live_room_ids()
    if not room_ids:
        return  # nobody's actually in a Watch Party room right now

    pool = await get_pool()
    for room_id in room_ids:
        async with pool.acquire() as conn:
            try:
                room = await watch_party_queries.get_room(conn, room_id)
                if room is None:
                    continue
                digest = await watch_party_domain.build_fantasy_digest(conn, room["league_id"])
            except Exception:
                logger.exception("Watch Party poll failed for room_id=%s", room_id)
                continue
        if digest is not None:
            await watch_party_manager.broadcast_to_room(room_id, digest)
    logger.info("Watch Party poll finished for %d room(s)", len(room_ids))


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


async def _run_draft_auto_start_job():
    """Flips a draft from 'not_started' to 'in_progress' on its own once
    the real clock reaches draft_config.scheduled_start (2026-09, "pre-
    draft room" feature) — the server's own clock decides this, not any
    client's, matching the feature's own "server is authoritative"
    requirement for the live/not-live transition. Same "is the draft
    system live" flag as the draft clock job above rather than a new
    env var (same reasoning as _run_draft_starting_soon_job already
    documents for reusing it).

    Every league with its own due, not-yet-started draft gets started
    independently, same "not just League #1" shape as the draft clock
    job. draft_engine.start_draft() has its own guard against double-
    starting (2026-09) — if a commissioner manually clicks "Start
    Draft" in the same instant this tick fires, exactly one of the two
    wins and the other is a clean no-op, never a rewind back to pick 1."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            "SELECT league_id FROM draft_config "
            "WHERE season = $1 AND status = 'not_started' AND scheduled_start IS NOT NULL "
            "AND scheduled_start <= $2",
            season, datetime.now(timezone.utc),
        )
        for row in due:
            league_id = row["league_id"]
            try:
                config = await draft_engine.start_draft(conn, season, league_id=league_id)
            except DraftError:
                logger.exception("Draft auto-start failed for season=%s league_id=%s", season, league_id)
                continue
            await draft_manager.broadcast_to_draft((season, league_id), {"type": "draft_status", "config": config})
            owner_rows = await conn.fetch(
                "SELECT DISTINCT owner_id FROM draft_picks WHERE season = $1 AND league_id = $2",
                season, league_id,
            )
            await notify_draft_live(season, league_id, [r["owner_id"] for r in owner_rows])
            await notify_on_the_clock(season, league_id, config)
            logger.info("Draft auto-started: season=%s league_id=%s", season, league_id)


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


async def _run_draft_room_open_job():
    """Pushes every real drafting owner once, the moment the pre-draft
    room actually opens — scheduled_start minus the room's own 1-hour
    window (frontend/src/components/draft/DraftRoom.tsx's
    PRE_DRAFT_WINDOW_MS). room_opened_notified_at is the idempotency
    flag (see its own migration), same simple <=-threshold shape as
    _run_keeper_lock_job/_run_draft_auto_start_job above rather than
    _run_draft_starting_soon_job's bounded window — "the room is open"
    stays true no matter how late this job gets to checking, unlike a
    countdown claim that can go stale, so there's nothing here that
    needs a narrower window to protect against."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            """
            SELECT league_id FROM draft_config
            WHERE season = $1 AND status = 'not_started' AND room_opened_notified_at IS NULL
              AND scheduled_start IS NOT NULL
              AND (scheduled_start - interval '1 hour') <= $2
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
            await notify_draft_room_open(season, league_id, owner_ids)
            await conn.execute(
                "UPDATE draft_config SET room_opened_notified_at = now() WHERE season = $1 AND league_id = $2",
                season, league_id,
            )
            logger.info("Draft room-open notification sent: season=%s league_id=%s", season, league_id)


async def _run_draft_grades_job():
    """Polls for any draft_config with status='complete' and no
    draft_grades computed yet, and computes grades + AI recaps for it —
    the decoupled follow-up to a draft finishing (see
    app/domain/draft_engine.py's _advance_to_next_open_pick, the one
    place a draft actually completes). Deliberately NOT run inline
    there: that function is on the hot path of every single pick, not
    just the last one, and grading needs every team's total before any
    one team's grade is final anyway (it's a batch computation by
    nature, not a per-pick one). No ACTIVE_SEASON scoping — draft_config
    is a tiny table, and a plain sweep for "any newly completed draft"
    means this keeps working across a season rollover with zero extra
    logic. The NOT EXISTS check against draft_grades is the idempotency
    gate — a manual re-trigger is just deleting that season/league's
    rows and waiting for the next tick, same "check whether the derived
    data already exists" pattern this app already prefers over adding a
    tracking column to draft_config itself."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        pending = await conn.fetch(
            """
            SELECT dc.season, dc.league_id FROM draft_config dc
            WHERE dc.status = 'complete'
              AND NOT EXISTS (
                  SELECT 1 FROM draft_grades dg
                  WHERE dg.season = dc.season AND dg.league_id = dc.league_id
              )
            """
        )
        for row in pending:
            season, league_id = row["season"], row["league_id"]
            try:
                count = await compute_draft_grades(conn, season, league_id)
                if count:
                    await generate_draft_narratives(conn, season, league_id)
                logger.info("Draft grades computed: season=%s league_id=%s teams=%s", season, league_id, count)
            except Exception:
                logger.exception("Draft grade computation failed: season=%s league_id=%s", season, league_id)


async def _run_keeper_deadline_warning_job():
    """Pushes every real drafting owner once, ~30 minutes before their
    league's keeper selection deadline (league_keeper_rules.
    keeper_deadline) — deadline_warning_notified_at is the idempotency
    flag (see its own migration). Only leagues that actually use
    keepers (max_keepers > 0) and haven't locked yet are ever selected,
    same "uses keepers" gate _run_keeper_lock_job above already
    documents. Owners are read off draft_picks (same source every other
    draft-day push in this file uses), which requires a real
    draft_config to already exist for the season — true for any league
    far enough along to have a real keeper_deadline set in the first
    place."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            """
            SELECT lkr.league_id
            FROM league_keeper_rules lkr
            WHERE lkr.season = $1
              AND lkr.max_keepers > 0
              AND lkr.locked_at IS NULL
              AND lkr.deadline_warning_notified_at IS NULL
              AND lkr.keeper_deadline IS NOT NULL
              AND (lkr.keeper_deadline - interval '30 minutes') <= $2
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
            await notify_keeper_deadline_approaching(season, league_id, owner_ids, minutes=30)
            await conn.execute(
                "UPDATE league_keeper_rules SET deadline_warning_notified_at = now() "
                "WHERE season = $1 AND league_id = $2",
                season, league_id,
            )
            logger.info("Keeper-deadline warning sent: season=%s league_id=%s", season, league_id)


async def _run_weekly_compute_job():
    """Sweeps every league with real teams for this season (teams_by_
    season, same table app/queries/league.py's own per-league season
    list already reads) rather than just League #1 — previously the
    single biggest multi-league gap in the app: the league-scoped read
    routers (standings, power rankings, awards) were already fixed to
    respect the caller's active league, but nothing ever computed that
    data for any league except League #1, so a second league's pages
    would render correctly but permanently empty. Same per-league loop
    + per-iteration try/except pattern as _run_draft_grades_job above,
    so one league's failure (compute or playoff resolution) can never
    block another's — most importantly, never blocks League #1's own
    real, live, real-money weekly compute."""
    games = await get_nfl_scoreboard()
    if not is_nfl_game_live(games):
        return

    espn_config = ESPNConfig()
    season = espn_config.active_season
    week = await get_real_current_week()
    if week is None:
        return

    pool = await get_pool()
    async with pool.acquire() as conn:
        league_rows = await conn.fetch(
            "SELECT DISTINCT league_id FROM teams_by_season WHERE season = $1 ORDER BY league_id",
            season,
        )
    league_ids = [row["league_id"] for row in league_rows]

    for league_id in league_ids:
        try:
            results = await weekly_stats.compute_and_store_week(pool, season, week, league_id=league_id)
            logger.info(
                "Weekly compute finished (season=%s week=%s league_id=%s): %s", season, week, league_id, results
            )
        except Exception:
            logger.exception("Weekly compute failed: season=%s week=%s league_id=%s", season, week, league_id)
            continue

        # Real scores for this league's week just landed — this is the
        # natural place to check whether any of its playoff bracket
        # nodes (app/domain/playoffs.py) are now fully scored and ready
        # to resolve. A no-op most weeks/leagues (no bracket generated
        # yet, or nothing ready); best-effort so a playoff-resolution
        # failure never breaks the compute step above.
        try:
            async with pool.acquire() as conn:
                resolved = await resolve_ready_playoff_matchups(conn, season, league_id)
            if resolved:
                logger.info("Playoff bracket resolved (season=%s league_id=%s): %s", season, league_id, resolved)
        except Exception:
            logger.exception(
                "Playoff bracket resolution failed (season=%s week=%s league_id=%s)", season, week, league_id
            )

    record_job_run("weekly_compute")


async def _run_waiver_processing_job():
    """See this module's own docstring — resolves every league's expired
    waiver_wire rows. Needs the real current NFL week (to know which
    week's priority order applies); skipped entirely, with no
    record_job_run call, if that isn't resolvable yet (pre-season/
    pre-sync), same "nothing to do" shape as _run_weekly_compute_job's
    own is_nfl_game_live early-return above."""
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        current_week = await league_queries.get_cached_current_week(conn, season)
        if current_week is None:
            return
        due_leagues = await conn.fetch(
            "SELECT DISTINCT league_id FROM waiver_wire WHERE season = $1 AND clears_at <= now()", season,
        )
        for row in due_leagues:
            league_id = row["league_id"]
            results = await waivers.process_expired_waivers(conn, season, league_id, current_week)
            if results:
                logger.info(
                    "Waiver processing: season=%s league_id=%s week=%s results=%s",
                    season, league_id, current_week, results,
                )
    record_job_run("waiver_processing")


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

    if os.getenv("ENABLE_WEEK_SETTLEMENT_SCHEDULER", "").lower() in ("1", "true", "yes"):
        # See _run_week_settlement_job's own docstring for why this is
        # a separate job from live sync above rather than just widening
        # that one's is_nfl_game_live gate: this needs to keep checking
        # all week long (not just during a live game window), but the
        # real settlement work it does only actually runs once per real
        # rollover, so a several-minute interval both catches up
        # promptly and stays cheap the rest of the time.
        interval_seconds = int(os.getenv("WEEK_SETTLEMENT_INTERVAL_SECONDS", "300"))
        _scheduler.add_job(_run_week_settlement_job, "interval", seconds=interval_seconds, id="week_settlement")
        logger.info("Week settlement scheduler started (every %d seconds, all week)", interval_seconds)
        started_any = True

    if os.getenv("ENABLE_GAMECAST_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_seconds = int(os.getenv("GAMECAST_POLL_INTERVAL_SECONDS", "4"))
        _scheduler.add_job(_run_gamecast_poll_job, "interval", seconds=interval_seconds, id="gamecast_poll")
        logger.info(
            "Gamecast poll scheduler started (every %d seconds, only during NFL game windows with active viewers)",
            interval_seconds,
        )
        started_any = True

    if os.getenv("ENABLE_WATCH_PARTY_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_seconds = int(os.getenv("WATCH_PARTY_POLL_INTERVAL_SECONDS", "30"))
        _scheduler.add_job(_run_watch_party_poll_job, "interval", seconds=interval_seconds, id="watch_party_poll")
        logger.info(
            "Watch Party poll scheduler started (every %d seconds, only during NFL game windows with active rooms)",
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
        _scheduler.add_job(_run_draft_auto_start_job, "interval", seconds=2, id="draft_auto_start")
        logger.info("Draft auto-start scheduler started (every 2 seconds)")
        _scheduler.add_job(_run_draft_room_open_job, "interval", seconds=60, id="draft_room_open")
        logger.info("Draft room-open reminder scheduler started (every 60 seconds)")
        _scheduler.add_job(_run_draft_grades_job, "interval", seconds=60, id="draft_grades")
        logger.info("Draft grades scheduler started (every 60 seconds)")
        started_any = True

    if os.getenv("ENABLE_KEEPER_LOCK_SCHEDULER", "").lower() in ("1", "true", "yes"):
        _scheduler.add_job(_run_keeper_lock_job, "interval", seconds=60, id="keeper_lock")
        logger.info("Keeper auto-lock scheduler started (every 60 seconds)")
        # Same enable flag as the lock job above — both are "is the keeper
        # deadline system live" concerns, not worth a second env var.
        _scheduler.add_job(_run_keeper_deadline_warning_job, "interval", seconds=60, id="keeper_deadline_warning")
        logger.info("Keeper-deadline warning scheduler started (every 60 seconds)")
        started_any = True

    if os.getenv("ENABLE_WEEKLY_COMPUTE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_seconds = int(os.getenv("WEEKLY_COMPUTE_INTERVAL_SECONDS", "120"))
        _scheduler.add_job(_run_weekly_compute_job, "interval", seconds=interval_seconds, id="weekly_compute")
        logger.info(
            "Weekly compute scheduler started (every %d seconds, only during NFL game windows)",
            interval_seconds,
        )
        started_any = True

    if os.getenv("ENABLE_WAIVER_PROCESSING_SCHEDULER", "").lower() in ("1", "true", "yes"):
        interval_seconds = int(os.getenv("WAIVER_PROCESSING_INTERVAL_SECONDS", "3600"))
        _scheduler.add_job(_run_waiver_processing_job, "interval", seconds=interval_seconds, id="waiver_processing")
        logger.info("Waiver processing scheduler started (every %d seconds)", interval_seconds)
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
