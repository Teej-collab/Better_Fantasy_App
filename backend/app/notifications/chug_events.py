"""
League-wide "a chug was just posted" push notification — every other
owner in the league gets told once a real graded chug lands (see
app/routers/chug.py's upload endpoint), same notify_league category
app/routers/settings.py already exposes but that, until now, had no
real event source (see NotificationsSection.tsx's own comment on why
League stayed hidden from the toggle list until it did).

A push failure here must never break a chug upload — this swallows and
logs its own errors, same discipline as app/notifications/
fantasy_events.py.
"""
import logging

from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)


async def notify_chug_posted(
    conn, season: int, league_id: int, poster_owner_id: int, poster_name: str, final_score: float, has_video: bool,
    chug_id: int | None = None,
) -> None:
    try:
        owner_rows = await conn.fetch(
            "SELECT DISTINCT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2",
            season, league_id,
        )
        payload = dispatcher.in_league(formatter.chug_posted(poster_name, final_score, has_video, chug_id), league_id, league_wide=True)
        for row in owner_rows:
            owner_id = row["owner_id"]
            if owner_id == poster_owner_id:
                continue
            prefs = await preferences_queries.get_preferences(conn, owner_id)
            if prefs["push_enabled"] and prefs["notify_league"]:
                await dispatcher.send_to_owner(conn, owner_id, payload)
    except Exception:
        logger.exception(
            "Chug-posted push notification failed (season=%s league_id=%s poster_owner_id=%s)",
            season, league_id, poster_owner_id,
        )


async def notify_chug_cheered(conn, league_id: int, chug_id: int, chugger_owner_id: int, cheerer_name: str) -> None:
    """Tells the chugger someone cheered their chug. About them, not
    league chatter, so not league_wide."""
    try:
        prefs = await preferences_queries.get_preferences(conn, chugger_owner_id)
        if prefs["push_enabled"]:
            payload = dispatcher.in_league(formatter.chug_cheered(cheerer_name, chug_id), league_id)
            await dispatcher.send_to_owner(conn, chugger_owner_id, payload)
    except Exception:
        logger.exception("Chug-cheered push failed (chug_id=%s owner_id=%s)", chug_id, chugger_owner_id)
