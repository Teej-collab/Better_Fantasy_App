"""
The commissioner change log (2026-10-23): every change a commissioner
makes to their league — a setting, a member's role, a trade decision, a
lineup fixed on someone's behalf — written as one plain sentence
("Trade deadline: Nov 13 → Nov 20"). The commissioner reads it in
Commissioner → Commish Corner; the league reads it in League → Activity
unless the commissioner turned that off (leagues.commish_log_public).

record() never fails the change it describes: the change has already
happened, so a logging problem is logged and swallowed.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

AREAS = (
    "league", "scoring", "roster", "keepers", "waivers", "draft", "trades", "members",
    "teams", "lineups", "chat", "polls", "espn", "announcements", "playoffs",
)


async def record(conn, league_id: int, user_id: int | None, area: str, summary: str) -> None:
    try:
        # Its own savepoint, so a failure here can't abort a transaction
        # the caller is still in.
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO commish_changes (league_id, actor_user_id, area, summary) VALUES ($1, $2, $3, $4)",
                league_id, user_id, area, summary[:300],
            )
    except Exception:
        logger.exception("Couldn't record a commissioner change (league %s: %s)", league_id, summary)


async def list_changes(conn, league_id: int, limit: int = 100, before_id: int | None = None) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT c.id, c.area, c.summary, c.created_at, c.actor_user_id, u.display_name AS actor_name
        FROM commish_changes c
        LEFT JOIN users u ON u.id = c.actor_user_id
        WHERE c.league_id = $1 AND ($3::int IS NULL OR c.id < $3)
        ORDER BY c.id DESC
        LIMIT $2
        """,
        league_id, limit, before_id,
    )
    return [
        {
            "id": r["id"],
            "area": r["area"],
            "summary": r["summary"],
            "created_at": r["created_at"].isoformat(),
            "actor_user_id": r["actor_user_id"],
            "actor_name": r["actor_name"] or "Commissioner",
        }
        for r in rows
    ]


def when(value: datetime | None) -> str:
    """A deadline the way the log says it: "Thu, Nov 20 6:00 PM" (ET), or "none"."""
    if value is None:
        return "none"
    local = value.astimezone(_ET)
    return local.strftime("%a, %b ") + str(local.day) + local.strftime(" %-I:%M %p")


def change(label: str, before, after) -> str | None:
    """"Label: before → after", or None when nothing changed."""
    if before == after:
        return None
    return f"{label}: {before} → {after}"


async def user_name(conn, user_id: int) -> str:
    name = await conn.fetchval(
        """
        SELECT COALESCE(o.display_name, u.display_name)
        FROM users u
        LEFT JOIN owner_users ou ON ou.user_id = u.id
        LEFT JOIN owners o ON o.owner_id = ou.owner_id
        WHERE u.id = $1
        """,
        user_id,
    )
    return name or "a member"
