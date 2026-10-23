"""The live system map's data (2026-10-22): the website's /brain page
reads this every few seconds and lights its parts from real values, not
guesses. Site admins only (require_site_admin, the admin dashboard's own
gate: League #1's commissioner and anyone with users.is_admin), and the
page itself is only served to whoever this lets through. Everything
here comes from this process's own memory or one trivial database
query: no ESPN call, nothing that could slow down or break the server
it's describing.
"""
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.league_context import optional_session_payload, require_site_admin
from app.chat.manager import manager as chat_manager
from app.db import get_pool
from app.draft.manager import manager as draft_manager
from app.gamecast.manager import manager as gamecast_manager
from app.monitoring import recent_requests, traffic_counts
from app.providers.espn_http import relay_status
from app.providers.nfl_scoreboard import live_scoreboard_status
from app.scheduler_lease import is_leader
from app.scheduler_status import PROCESS_STARTED_AT, get_job_ticks

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/status")
async def status(request: Request, pool=Depends(get_pool)):
    payload = optional_session_payload(request)
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
    started = time.perf_counter()
    db_ok = True
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception:
        db_ok = False
    db_ms = round((time.perf_counter() - started) * 1000)

    espn = relay_status()
    last_refused = espn.pop("last_refused_at")
    relay_failed = espn.pop("relay_last_failed_at")
    now = datetime.now(timezone.utc)
    return {
        "checked_at": now.isoformat(),
        "server": {
            "started_at": PROCESS_STARTED_AT.isoformat(),
            "uptime_seconds": int((now - PROCESS_STARTED_AT).total_seconds()),
            "deployment": (os.getenv("RAILWAY_DEPLOYMENT_ID") or "")[:8] or None,
            "runs_scheduled_jobs": is_leader(),
        },
        "database": {"ok": db_ok, "latency_ms": db_ms},
        "espn": {
            **espn,
            "last_refused_at": datetime.fromtimestamp(last_refused, timezone.utc).isoformat() if last_refused else None,
            "relay_last_failed_at": datetime.fromtimestamp(relay_failed, timezone.utc).isoformat() if relay_failed else None,
            "scoreboard": live_scoreboard_status(),
        },
        "jobs": get_job_ticks(),
        "traffic": traffic_counts(),
        # Each request of the last 15 seconds, for the Brain to draw along
        # its real path: [seconds_ago, "app"|"web", area, wrote].
        "recent_requests": recent_requests(15),
        "connections": {
            "chat": len(chat_manager.connected_owner_ids()),
            "draft": draft_manager.total_connection_count(),
            "gamecast": gamecast_manager.total_connection_count(),
        },
    }
