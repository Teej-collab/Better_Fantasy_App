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
    conn, season: int, league_id: int, poster_owner_id: int, poster_name: str, final_score: float, has_video: bool
) -> None:
    try:
        owner_rows = await conn.fetch(
            "SELECT DISTINCT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2",
            season, league_id,
        )
        payload = formatter.chug_posted(poster_name, final_score, has_video)
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
