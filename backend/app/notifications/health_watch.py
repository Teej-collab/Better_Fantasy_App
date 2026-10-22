"""
Health watch (2026-10-22): pushes the site's admins when something on
the live system map (the Brain, app/routers/system.py) goes wrong, and
again when it's back. app/scheduler.py runs check() every minute on the
copy of the server that holds the scheduler lease.

What it watches, all from this process's own memory plus one trivial
query, never ESPN itself:
- ESPN refusing the server (it's going through the Vercel relay);
- live scores paused (ESPN and the relay both failing, so screens show
  the saved scoreboard);
- a scheduled job failing over and over (3 runs in a row, or a single
  run of a job that only runs now and then, like the waiver run);
- a burst of server errors (20+ in five minutes);
- the database answering slowly (over 2 seconds).

A problem alerts once it's been seen on two checks in a row and is
cleared once it's been gone for three, so a blip never pings and a bad
game day is a couple of alerts, not one a minute. It can't report the
whole server being down; .github/workflows/uptime.yml watches for that
from outside.
"""
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from app.monitoring import traffic_counts
from app.notifications import admin_alerts, formatter
from app.providers.espn_http import relay_status
from app.providers.nfl_scoreboard import live_scoreboard_status
from app.scheduler_status import get_job_ticks

logger = logging.getLogger(__name__)

ALERT_AFTER_CHECKS = 2
CLEAR_AFTER_CHECKS = 3
JOB_FAILING_STREAK = 3
ERROR_BURST = 20
SLOW_DB_MS = 2000

# Jobs that run hourly or less, where one failed run is already news.
RARE_JOBS = {"waiver_processing", "week_settlement", "espn_full_sync", "sleeper_player_sync", "injury_watch"}

JOB_NAMES = {
    "espn_live_sync": "Live scoring",
    "week_settlement": "Settling the week",
    "weekly_compute": "Weekly stats",
    "espn_projected_points_sync": "Projections",
    "gamecast_poll": "Gamecast",
    "waiver_processing": "The waiver run",
    "trade_processing": "Trades",
    "sleeper_player_sync": "The Sleeper player update",
    "injury_watch": "Injury checks",
    "game_alerts": "Game alerts",
    "red_zone_alerts": "Red-zone alerts",
    "live_activity": "The Lock Screen score",
    "deferred_pushes": "Held notifications",
    "watch_party_poll": "Watch parties",
    "espn_full_sync": "The ESPN league sync",
}


@dataclass
class Problem:
    key: str
    title: str
    body: str


@dataclass
class _Tracked:
    problem: Problem
    seen: int = 0
    missing: int = 0
    alerted_at: datetime | None = None


_tracked: dict[str, _Tracked] = {}


def reset() -> None:
    _tracked.clear()


async def current_problems(conn) -> list[Problem]:
    problems: list[Problem] = []

    sb = live_scoreboard_status()
    if sb["serving_fallback"]:
        problems.append(Problem(
            "scores_paused", "Live scores paused",
            "ESPN isn't answering, even through the relay. Screens show the last saved scoreboard.",
        ))
    elif relay_status()["using_relay"]:
        problems.append(Problem(
            "espn_relay", "ESPN is refusing the server",
            "Going through the Vercel relay instead. Scores are still live.",
        ))

    for job_id, tick in get_job_ticks().items():
        streak = tick.get("failing_streak", 0)
        if streak >= JOB_FAILING_STREAK or (streak >= 1 and job_id in RARE_JOBS):
            name = JOB_NAMES.get(job_id, job_id)
            problems.append(Problem(
                f"job-{job_id}", f"{name} is failing",
                f"{streak} run{'s' if streak > 1 else ''} in a row. Last error: {(tick.get('last_error') or 'unknown')[:140]}",
            ))

    errors = traffic_counts()["errors_last_5_minutes"]
    if errors >= ERROR_BURST:
        problems.append(Problem("errors", "Server errors spiking", f"{errors} failed requests in the last 5 minutes."))

    started = time.perf_counter()
    await conn.fetchval("SELECT 1")
    db_ms = round((time.perf_counter() - started) * 1000)
    if db_ms > SLOW_DB_MS:
        problems.append(Problem("db_slow", "The database is slow", f"A trivial query took {db_ms / 1000:.1f} seconds."))

    return problems


def _lasted(since: datetime) -> str:
    minutes = round((datetime.now(timezone.utc) - since).total_seconds() / 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60} min"


async def check(conn) -> list[dict]:
    """One check: alerts for problems seen twice running, all-clears for
    problems gone three times running. Returns the pushes it sent."""
    now_problems = {p.key: p for p in await current_problems(conn)}
    sent: list[dict] = []

    for key, problem in now_problems.items():
        tracked = _tracked.setdefault(key, _Tracked(problem))
        tracked.problem = problem
        tracked.seen += 1
        tracked.missing = 0
        if tracked.alerted_at is None and tracked.seen >= ALERT_AFTER_CHECKS:
            payload = formatter.admin_health_alert(key, problem.title, problem.body, recovered=False)
            await admin_alerts._send(conn, payload)
            tracked.alerted_at = datetime.now(timezone.utc)
            sent.append(payload)

    for key in list(_tracked):
        if key in now_problems:
            continue
        tracked = _tracked[key]
        tracked.missing += 1
        if tracked.alerted_at is None:
            # Never alerted (a one-check blip): forget it quietly.
            del _tracked[key]
        elif tracked.missing >= CLEAR_AFTER_CHECKS:
            payload = formatter.admin_health_alert(
                key, tracked.problem.title, f"After {_lasted(tracked.alerted_at)}.", recovered=True,
            )
            await admin_alerts._send(conn, payload)
            del _tracked[key]
            sent.append(payload)

    if sent:
        logger.info("Health watch sent %s", [p["title"] for p in sent])
    return sent
