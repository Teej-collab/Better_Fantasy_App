"""
The lock-screen and Dynamic Island live score (iOS Live Activities,
2026-10), kept current from the server so it updates while the phone is
locked and the app is closed.

Every tick (app/scheduler.py's live_activity job):
- each running Live Activity gets the owner's matchup rebuilt with the
  same build_your_week the app's Home uses, and a push only when what it
  shows changed. A final matchup gets an "end" that leaves the result up
  for an hour; a Live Activity left over from another matchup is ended.
- while NFL games are live, a device with a push-to-start token whose
  matchup is underway, and that has no Live Activity running for it,
  gets one started remotely — once per matchup.
- while NFL games are live, iOS devices get a silent push every 15
  minutes so the app can refresh the home-screen widget in the
  background (iOS decides whether it actually runs).

The props match mobile/src/widgets/MatchupActivity.tsx's
MatchupActivityProps — change the two together.
"""
import json
import logging
import time
from datetime import datetime, timezone

from app.config import _require
from app.domain.your_week import build_your_week
from app.notifications import apns_client
from app.providers.nfl_scoreboard import get_nfl_scoreboard, is_nfl_game_live
from app.queries import live_activities as queries
from app.queries import native_push_tokens as native_queries

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "MatchupActivity"
# Never push the same Live Activity more often than this, however fast
# scores move — Apple throttles Live Activity pushes per app.
MIN_SECONDS_BETWEEN_UPDATES = 10
# A finished matchup stays on the lock screen this long.
FINAL_DISMISS_SECONDS = 3600
WIDGET_REFRESH_SECONDS = 15 * 60

_last_widget_refresh = 0.0


def props_for(week: dict | None) -> dict | None:
    """A matchup for the lock screen, or None when there isn't one this
    week. Mirrors mobile/src/lib/homeWidget.ts's widgetPropsFor."""
    m = (week or {}).get("matchup")
    if not week or not m:
        return None
    my_left = m["my_yet_to_play"] + m["my_in_play"]
    opp_left = m["opponent_yet_to_play"] + m["opponent_in_play"]
    if not m["started"]:
        state = "pre"
    elif m["my_in_play"] + m["opponent_in_play"] > 0:
        state = "live"
    elif my_left + opp_left == 0:
        state = "final"
    else:
        state = "between"
    return {
        "state": state,
        "week": week.get("week"),
        "myName": week["team_name"],
        "oppName": m["opponent_team_name"] or "Opponent",
        "myScore": round(m["my_score"] or 0, 1),
        "oppScore": round(m["opponent_score"] or 0, 1),
        "myProjected": round(m["my_projected_total"] or 0, 1),
        "oppProjected": round(m["opponent_projected_total"] or 0, 1),
        "myLeft": my_left,
        "oppLeft": opp_left,
        "winProbability": round(m["win_probability"]) if m["win_probability"] is not None else None,
        "matchupId": m["matchup_id"],
    }


def _content_state(props: dict) -> dict:
    stamped = {**props, "updatedAt": int(time.time() * 1000)}
    return {"name": ACTIVITY_NAME, "props": json.dumps(stamped, separators=(",", ":"))}


def _comparable(props: dict) -> str:
    return json.dumps(props, sort_keys=True, separators=(",", ":"))


def _alert_for_start(props: dict) -> dict:
    return {
        "title": f"Week {props['week']} is live" if props.get("week") else "Your matchup is live",
        "body": f"{props['myName']} vs {props['oppName']}",
    }


async def run_tick(pool) -> dict:
    """One pass; returns counts for the logs and tests."""
    global _last_widget_refresh
    counts = {"updated": 0, "ended": 0, "started": 0, "widget_refreshes": 0}
    async with pool.acquire() as conn:
        activities = await queries.list_active(conn, "activity")
        starts = await queries.list_active(conn, "start")

    nfl_live = None

    async def games_live() -> bool:
        nonlocal nfl_live
        if nfl_live is None:
            try:
                nfl_live = is_nfl_game_live(await get_nfl_scoreboard())
            except Exception:
                logger.warning("Live Activity tick couldn't read the NFL scoreboard", exc_info=True)
                nfl_live = False
        return nfl_live

    if not activities and not starts and not await games_live():
        return counts

    season = int(_require("ACTIVE_SEASON"))
    weeks: dict[tuple[int, int], dict | None] = {}

    async def week_for(owner_id: int, league_id: int):
        key = (owner_id, league_id)
        if key not in weeks:
            async with pool.acquire() as conn:
                try:
                    weeks[key] = await build_your_week(conn, owner_id, season, league_id)
                except Exception:
                    logger.warning("Live Activity tick couldn't build owner_id=%s's week", owner_id, exc_info=True)
                    weeks[key] = None
        return weeks[key]

    now = datetime.now(timezone.utc)
    for row in activities:
        props = props_for(await week_for(row["owner_id"], row["league_id"]))
        stale_matchup = props is not None and row["matchup_id"] is not None and props["matchupId"] != row["matchup_id"]
        if props is None or stale_matchup:
            aps = {"timestamp": int(time.time()), "event": "end", "dismissal-date": int(time.time())}
            if row["last_props"]:
                aps["content-state"] = {"name": ACTIVITY_NAME, "props": row["last_props"]}
            await _send(pool, row, aps, priority=5)
            async with pool.acquire() as conn:
                await queries.deactivate_token(conn, row["id"])
            counts["ended"] += 1
            continue

        comparable = _comparable(props)
        if props["state"] == "final":
            aps = {
                "timestamp": int(time.time()),
                "event": "end",
                "content-state": _content_state(props),
                "dismissal-date": int(time.time()) + FINAL_DISMISS_SECONDS,
            }
            await _send(pool, row, aps, priority=10)
            async with pool.acquire() as conn:
                await queries.deactivate_token(conn, row["id"])
            counts["ended"] += 1
            continue

        if comparable == row["last_props"]:
            continue
        if row["last_sent_at"] is not None and (now - row["last_sent_at"]).total_seconds() < MIN_SECONDS_BETWEEN_UPDATES:
            continue
        aps = {"timestamp": int(time.time()), "event": "update", "content-state": _content_state(props)}
        # Live scoring is worth an immediate update; anything else can wait for a cheaper slot.
        if await _send(pool, row, aps, priority=10 if props["state"] == "live" else 5):
            async with pool.acquire() as conn:
                await queries.record_sent(conn, row["id"], comparable)
            counts["updated"] += 1

    if starts and await games_live():
        for row in starts:
            props = props_for(await week_for(row["owner_id"], row["league_id"]))
            if not props or props["state"] != "live":
                continue
            async with pool.acquire() as conn:
                if await queries.has_active_activity(conn, row["owner_id"], props["matchupId"]):
                    continue
                if not await queries.claim_remote_start(conn, row["owner_id"], props["matchupId"]):
                    continue
            aps = {
                "timestamp": int(time.time()),
                "event": "start",
                "attributes-type": "LiveActivityAttributes",
                "attributes": {},
                "content-state": _content_state(props),
                "alert": _alert_for_start(props),
            }
            if await _send(pool, row, aps, priority=10):
                counts["started"] += 1

    if await games_live() and time.time() - _last_widget_refresh >= WIDGET_REFRESH_SECONDS:
        _last_widget_refresh = time.time()
        async with pool.acquire() as conn:
            devices = await native_queries.list_active_ios_registrations(conn)
        for device in devices:
            try:
                _, gone = await apns_client.send_background_refresh(device["push_token"], {"type": "widget_refresh"})
            except Exception:
                logger.warning("Widget refresh push failed", exc_info=True)
                continue
            if gone:
                async with pool.acquire() as conn:
                    await native_queries.deactivate_registration(conn, device["owner_id"], device["device_id"])
            counts["widget_refreshes"] += 1

    return counts


async def _send(pool, row, aps: dict, priority: int) -> bool:
    try:
        delivered, gone = await apns_client.send_live_activity(row["token"], aps, priority=priority)
    except Exception:
        logger.warning("Live Activity push to token id=%s failed", row["id"], exc_info=True)
        return False
    if gone:
        async with pool.acquire() as conn:
            await queries.deactivate_token(conn, row["id"])
    return delivered
