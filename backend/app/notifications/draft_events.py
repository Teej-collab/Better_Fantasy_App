"""
Push triggers for the in-app draft — shared by app/routers/draft.py
(a manual pick, start_draft) and app/scheduler.py's draft-clock job
(autopick), both of which can advance whose turn it is. Lives here
rather than inside either caller so neither has to import the other
(scheduler.py sits beside the routers, not below them).

"You're on the clock" is a rare, time-critical alert — much like the
commish_corner override in app/routers/chat.py's own push logic, it
bypasses the normal per-owner notification-category toggles and only
respects the master push_enabled switch. A push failure here must
never break the pick that triggered it, so every public function below
swallows and logs its own errors rather than raising.
"""
import logging
from datetime import datetime, timezone

from app.db import get_pool
from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)


async def notify_on_the_clock(season: int, league_id: int, config: dict) -> None:
    """config is a draft_config row/dict (app/domain/draft_engine.py's
    _config_dict shape) from right after a turn actually advanced —
    call this once per real advancement (a manual pick, an autopick,
    or start_draft), not on every WS broadcast, so an owner doesn't get
    re-notified for a turn that's still theirs."""
    if config.get("status") != "in_progress" or config.get("current_pick_deadline") is None:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            pick = await conn.fetchrow(
                "SELECT owner_id, round FROM draft_picks WHERE season = $1 AND pick_number = $2 AND league_id = $3",
                season, config["current_pick_number"], league_id,
            )
            if pick is None:
                return
            prefs = await preferences_queries.get_preferences(conn, pick["owner_id"])
            if not prefs["push_enabled"]:
                return
            seconds = max(1, round((config["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()))
            await dispatcher.send_to_owner(
                conn,
                pick["owner_id"],
                formatter.draft_on_the_clock(pick["round"], config["current_pick_number"], seconds),
            )
    except Exception:
        logger.exception("Draft on-the-clock push failed for season=%s league_id=%s", season, league_id)


async def notify_draft_starting_soon(season: int, league_id: int, owner_ids: list[int], minutes: int) -> None:
    """Every real league member (not just currently-connected ones —
    this is exactly the case someone ISN'T in the app yet) gets pushed
    once, per app/scheduler.py's own reminder job."""
    if not owner_ids:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            payload = formatter.draft_starting_soon(minutes)
            for owner_id in owner_ids:
                prefs = await preferences_queries.get_preferences(conn, owner_id)
                if prefs["push_enabled"]:
                    await dispatcher.send_to_owner(conn, owner_id, payload)
    except Exception:
        logger.exception("Draft-starting-soon push failed for season=%s league_id=%s", season, league_id)


async def notify_draft_room_open(season: int, league_id: int, owner_ids: list[int]) -> None:
    """Every real league member gets pushed once, the moment the pre-
    draft room actually opens (app/scheduler.py's own room-open job,
    2026-09) — same "every member, not just connected ones" shape as
    notify_draft_starting_soon above, since the whole point is reaching
    someone who ISN'T already watching."""
    if not owner_ids:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            payload = formatter.draft_room_open()
            for owner_id in owner_ids:
                prefs = await preferences_queries.get_preferences(conn, owner_id)
                if prefs["push_enabled"]:
                    await dispatcher.send_to_owner(conn, owner_id, payload)
    except Exception:
        logger.exception("Draft-room-open push failed for season=%s league_id=%s", season, league_id)


async def notify_draft_live(season: int, league_id: int, owner_ids: list[int]) -> None:
    """Every real league member gets pushed once, the moment the draft
    actually goes live — called from both the manual POST /draft/start
    (app/routers/draft.py) and app/scheduler.py's auto-start job, so it
    fires exactly once regardless of which of the two actually started
    the draft (start_draft() itself refuses a second real start — see
    its own docstring — so there's no risk of double-firing this from
    both paths racing). Distinct from notify_on_the_clock, which only
    ever reaches whoever's specific pick it currently is, and from
    notify_draft_starting_soon, which fires ahead of time, not at the
    real moment picking actually opens."""
    if not owner_ids:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            payload = formatter.draft_live()
            for owner_id in owner_ids:
                prefs = await preferences_queries.get_preferences(conn, owner_id)
                if prefs["push_enabled"]:
                    await dispatcher.send_to_owner(conn, owner_id, payload)
    except Exception:
        logger.exception("Draft-live push failed for season=%s league_id=%s", season, league_id)


async def notify_keeper_deadline_approaching(season: int, league_id: int, owner_ids: list[int], minutes: int) -> None:
    """Every real league member gets pushed once, ~30 minutes before
    keeper selections lock (app/scheduler.py's own keeper-deadline-
    warning job, 2026-09) — lives here alongside the draft's other
    schedule-adjacent pushes rather than a separate keepers-
    notifications module, since it's the same "real draft-day deadline
    someone might miss" concern as everything else in this file."""
    if not owner_ids:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            payload = formatter.keeper_deadline_approaching(minutes)
            for owner_id in owner_ids:
                prefs = await preferences_queries.get_preferences(conn, owner_id)
                if prefs["push_enabled"]:
                    await dispatcher.send_to_owner(conn, owner_id, payload)
    except Exception:
        logger.exception("Keeper-deadline-approaching push failed for season=%s league_id=%s", season, league_id)
