"""
Push when a room starts (2026-10, commissioner's request): an open
watch party tells the rest of the league once, when it's created; a
private room tells only the people invited. The League Lounge never
notifies, since it's always open. Both respect push_enabled and the
Watch Parties switch (notify_watch_parties).

Runs after the room is created and never breaks it: errors are logged
and swallowed, same as app/notifications/chug_events.py.
"""
import logging

from app.db import get_pool
from app.notifications import dispatcher, formatter
from app.providers.nfl_scoreboard import get_nfl_scoreboard
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)


async def _game_label(game_id: str | None) -> str | None:
    if not game_id:
        return None
    try:
        for g in await get_nfl_scoreboard():
            if str(g.get("id")) == game_id and g.get("away_team") and g.get("home_team"):
                return f"{g['away_team']} @ {g['home_team']}"
    except Exception:
        logger.warning("Couldn't name game %s for a watch party push", game_id, exc_info=True)
    return None


async def _send(conn, owner_ids: list[int], payload: dict) -> None:
    for owner_id in owner_ids:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
        if prefs["push_enabled"] and prefs["notify_watch_parties"]:
            await dispatcher.send_to_owner(conn, owner_id, payload)


async def notify_party_started(
    season: int, league_id: int, host_owner_id: int, host_name: str, room_id: int, room_name: str, game_id: str | None
) -> None:
    try:
        payload = formatter.watch_party_started(host_name, room_name, room_id, await _game_label(game_id))
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT DISTINCT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2 AND owner_id IS NOT NULL",
                season, league_id,
            )
            await _send(conn, [r["owner_id"] for r in rows if r["owner_id"] != host_owner_id], payload)
    except Exception:
        logger.exception("Watch party push failed (room_id=%s)", room_id)


async def notify_room_invite(host_name: str, room_id: int, room_name: str, invited_owner_ids: list[int]) -> None:
    try:
        payload = formatter.watch_party_invite(host_name, room_name, room_id)
        pool = await get_pool()
        async with pool.acquire() as conn:
            await _send(conn, invited_owner_ids, payload)
    except Exception:
        logger.exception("Private room invite push failed (room_id=%s)", room_id)
