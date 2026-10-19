"""Only one copy of the backend runs the scheduled jobs.

Every job in app/scheduler.py assumes it's alone: two copies would both
settle the week, both process waivers and both send every push. This
module keeps a lease row (migrations/versions/a4c9e1f7b2d5) naming the
copy that holds it; a heartbeat job renews it every HEARTBEAT_SECONDS
and every other job checks `is_leader()` — a plain flag, no query —
before doing anything.

- A copy that stops renewing (crashed, hung, lost the database) loses
  the lease LEASE_SECONDS after its last renewal, and the next copy to
  beat takes over.
- A clean shutdown gives the lease up straight away, so a deploy hands
  over within one heartbeat of the old container stopping instead of
  waiting out the lease.
- A failed renewal drops the flag at once: a copy that can't reach the
  database can't prove it still holds the lease, so it stops running
  jobs rather than risk running alongside whoever took over.
- If the table isn't there yet (code deployed before the migration was
  applied by hand), every copy runs its jobs exactly as before this
  guard existed, logged once — never "nobody runs anything".

Not an advisory lock: DATABASE_URL goes through Supabase's
transaction-mode pooler, which doesn't keep a session lock with any one
copy.
"""
import logging
import os
import socket
import uuid

import asyncpg

from app.db import get_pool

logger = logging.getLogger(__name__)

LEASE_NAME = "scheduler"
HEARTBEAT_SECONDS = 5
LEASE_SECONDS = 20

# Who this copy is, in the row — the hostname makes the admin side
# readable, the random part keeps two processes on one host apart.
HOLDER = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"

_leader = False
_missing_table_logged = False


def is_leader() -> bool:
    return _leader


async def try_hold(conn, name: str, holder: str, lease_seconds: int) -> bool:
    """Take or renew the lease in one statement: insert it, or take it
    over if it's ours already or has run out. Anything else leaves the
    row alone and returns no row."""
    row = await conn.fetchrow(
        """
        INSERT INTO scheduler_lease (name, holder, expires_at)
        VALUES ($1, $2, now() + make_interval(secs => $3))
        ON CONFLICT (name) DO UPDATE
            SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
            WHERE scheduler_lease.holder = EXCLUDED.holder
               OR scheduler_lease.expires_at < now()
        RETURNING holder
        """,
        name, holder, float(lease_seconds),
    )
    return row is not None


async def release(conn, name: str, holder: str) -> None:
    await conn.execute("DELETE FROM scheduler_lease WHERE name = $1 AND holder = $2", name, holder)


async def heartbeat() -> None:
    global _leader, _missing_table_logged
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            held = await try_hold(conn, LEASE_NAME, HOLDER, LEASE_SECONDS)
    except asyncpg.UndefinedTableError:
        if not _missing_table_logged:
            logger.warning("scheduler_lease table missing — running scheduled jobs unguarded until it's migrated")
            _missing_table_logged = True
        _leader = True
        return
    except Exception:
        if _leader:
            logger.exception("Couldn't renew the scheduler lease — pausing scheduled jobs")
        _leader = False
        return
    _missing_table_logged = False
    if held != _leader:
        logger.info("Scheduler lease %s by %s", "taken" if held else "lost", HOLDER)
    _leader = held


async def give_up() -> None:
    global _leader
    if not _leader or _missing_table_logged:
        _leader = False
        return
    _leader = False
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await release(conn, LEASE_NAME, HOLDER)
    except Exception:
        # It runs out on its own LEASE_SECONDS later.
        logger.exception("Couldn't release the scheduler lease")
