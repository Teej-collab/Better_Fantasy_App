"""
The weekly recap goes live at the Tuesday flip, not the moment it's
written (2026-10, the owner's call): it's still generated as soon as the
week's last game is final (scheduler._run_week_settlement_job), but
league members only see it once the league has flipped past that week —
app/domain/week_flip.py's 2 PM Central Tuesday — and the flip pushes
everyone "Week N Recap LIVE NOW". Commissioners can see it early to
proof or regenerate it.

"Released" is read straight from league_state.current_week (the flip is
exactly what advances it), so it needs no separate flag to keep in sync.
recap_releases records the release itself — exactly once per league and
week (its primary key), with how many owners were notified — for the
admin dashboard's Recaps page.
"""
import logging

from app.domain import narrative_engine
from app.notifications import dispatcher, formatter
from app.queries import league as league_queries
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)


def is_released_week(week: int, current_week: int | None) -> bool:
    """A week's recap is public once the league's current week has moved
    past it. No league_state row at all (nothing synced for that season)
    means there's no flip to wait for."""
    return current_week is None or week < current_week


async def is_recap_released(conn, season: int, week: int) -> bool:
    return is_released_week(week, await league_queries.get_cached_current_week(conn, season))


async def release_and_notify(conn, season: int, week: int, league_id: int, notify: bool = True) -> int | None:
    """Releases this league's recap for the week and pushes every member
    "Week N Recap LIVE NOW" (League notifications on, push enabled).
    Returns how many owners were notified, or None if there was nothing
    to release (no recap generated yet) or it was already released —
    the recap_releases row makes a re-run a no-op, never a second push.
    notify=False records the release without pushing anyone (an old
    week's recap generated long after its flip)."""
    narrative = await narrative_engine.get_cached_weekly_narrative(conn, season, week, league_id)
    if narrative is None or narrative["kind"] != "recap":
        return None
    claimed = await conn.fetchval(
        """
        INSERT INTO recap_releases (league_id, season, week) VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING RETURNING week
        """,
        league_id, season, week,
    )
    if claimed is None:
        return None
    if not notify:
        return 0

    payload = formatter.weekly_recap_live(season, week, narrative["text"])
    owner_rows = await conn.fetch(
        "SELECT DISTINCT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    notified = 0
    for row in owner_rows:
        try:
            prefs = await preferences_queries.get_preferences(conn, row["owner_id"])
            if prefs["push_enabled"] and prefs["notify_league"]:
                if await dispatcher.send_to_owner(conn, row["owner_id"], payload):
                    notified += 1
        except Exception:
            logger.exception("Recap push failed (owner_id=%s week=%s)", row["owner_id"], week)
    await conn.execute(
        "UPDATE recap_releases SET notified_count = $4 WHERE league_id = $1 AND season = $2 AND week = $3",
        league_id, season, week, notified,
    )
    logger.info("Recap released (league_id=%s season=%s week=%s notified=%s)", league_id, season, week, notified)
    return notified
