"""Real, live process/infra signals for the admin System Health panel
(app/routers/admin.py's GET /admin/system-health) — a genuine "is this
about to fall over" scaling read, not a placeholder. Every number here
is either a live DB pool stat (asyncpg's own accounting) or an in-
process WebSocket connection count (app/chat/manager.py, app/draft/
manager.py, app/gamecast/manager.py) — nothing fabricated, and nothing
that needs its own new logging pipeline the way real error/security
monitoring would (see ADMIN_DASHBOARD.md's Phase 2 list for why those
aren't here).
"""
from datetime import datetime, timezone

from app.chat.manager import manager as chat_manager
from app.draft.manager import manager as draft_manager
from app.gamecast.manager import manager as gamecast_manager
from app.scheduler_status import PROCESS_STARTED_AT, get_job_statuses


async def get_system_health(conn, pool) -> dict:
    db_reachable = await conn.fetchval("SELECT 1") == 1
    uptime_seconds = int((datetime.now(timezone.utc) - PROCESS_STARTED_AT).total_seconds())
    return {
        "db": {
            "reachable": db_reachable,
            "pool_size": pool.get_size(),
            "pool_idle": pool.get_idle_size(),
            "pool_max": pool.get_max_size(),
        },
        "websocket_connections": {
            "chat": len(chat_manager.connected_owner_ids()),
            "draft": draft_manager.total_connection_count(),
            "gamecast": gamecast_manager.total_connection_count(),
        },
        "uptime_seconds": uptime_seconds,
        # {job_name: ISO timestamp of its last successful finish, since
        # this process started} — a job that's off (see app/scheduler.py's
        # own docstring on the default-off env flags) or hasn't ticked
        # yet just never appears, which the frontend reads as "no data
        # yet" rather than a guessed value.
        "jobs": get_job_statuses(),
    }
