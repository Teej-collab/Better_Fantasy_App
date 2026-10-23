"""
Commish Corner posts from Commissioner Tools (2026-10-23): posted now,
or scheduled for later and posted by the scheduler once their time
comes. A post is an ordinary Commish Corner message (title + body), so
it shows in chat, live to open apps, with the read receipts the corner
already keeps; `notify` decides whether it also sends a push.

Also posts a league's waiver results to its Commish Corner after each
run, when its commissioner turned that on (waiver_settings.post_results).
"""
import logging

from app.chat.manager import manager
from app.domain import chat as chat_domain
from app.queries import chat as chat_queries

logger = logging.getLogger(__name__)

MAX_TITLE_LENGTH = 200  # the same caps chat uses for a Commish Corner post
MAX_BODY_LENGTH = 20000


async def corner_id(conn, league_id: int) -> int | None:
    return await conn.fetchval(
        "SELECT id FROM conversations WHERE league_id = $1 AND type = 'commish_corner' LIMIT 1", league_id
    )


async def owner_for_user(conn, user_id: int) -> tuple[int | None, str]:
    row = await conn.fetchrow(
        """
        SELECT ou.owner_id, COALESCE(o.display_name, u.display_name) AS name
        FROM users u
        LEFT JOIN owner_users ou ON ou.user_id = u.id
        LEFT JOIN owners o ON o.owner_id = ou.owner_id
        WHERE u.id = $1
        """,
        user_id,
    )
    return (row["owner_id"], row["name"] or "Commissioner") if row else (None, "Commissioner")


async def post(conn, league_id: int, user_id: int, title: str, body: str, notify: bool) -> int | None:
    """Posts to the league's Commish Corner; returns the message id, or
    None when the league has no corner or the author has no owner
    record to post as."""
    conversation_id = await corner_id(conn, league_id)
    owner_id, name = await owner_for_user(conn, user_id)
    if conversation_id is None or owner_id is None:
        return None
    row = await chat_queries.insert_message(conn, conversation_id, owner_id, body, None, None, title)
    message = await chat_domain.get_single_message(conn, row["id"], owner_id)
    participant_ids = await chat_queries.list_conversation_participant_ids(conn, conversation_id)
    try:
        await manager.broadcast_to_owners(participant_ids, {"type": "message", "message": message})
        if notify:
            # Imported here: the chat router imports the domain layer.
            from app.routers.chat import _push_notify_new_message
            await _push_notify_new_message(conversation_id, owner_id, name, body, None, [], participant_ids)
    except Exception:
        logger.exception("Commish Corner post %s saved but not delivered live", row["id"])
    return row["id"]


async def schedule(conn, league_id: int, user_id: int, title: str, body: str, notify: bool, send_at) -> int:
    return await conn.fetchval(
        """
        INSERT INTO scheduled_announcements (league_id, author_user_id, title, body, notify, send_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        """,
        league_id, user_id, title, body, notify, send_at,
    )


async def list_scheduled(conn, league_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id, title, body, notify, send_at, created_at FROM scheduled_announcements
        WHERE league_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL
        ORDER BY send_at
        """,
        league_id,
    )
    return [
        {"id": r["id"], "title": r["title"], "body": r["body"], "notify": r["notify"],
         "send_at": r["send_at"].isoformat(), "created_at": r["created_at"].isoformat()}
        for r in rows
    ]


async def list_recent_posts(conn, league_id: int, limit: int = 10) -> list[dict]:
    conversation_id = await corner_id(conn, league_id)
    if conversation_id is None:
        return []
    rows = await conn.fetch(
        """
        SELECT id, title, body, created_at FROM messages
        WHERE conversation_id = $1 AND deleted_at IS NULL AND title IS NOT NULL
        ORDER BY id DESC LIMIT $2
        """,
        conversation_id, limit,
    )
    return [{"id": r["id"], "title": r["title"], "body": r["body"], "created_at": r["created_at"].isoformat()} for r in rows]


async def cancel(conn, league_id: int, announcement_id: int) -> bool:
    result = await conn.execute(
        "UPDATE scheduled_announcements SET cancelled_at = now() "
        "WHERE id = $1 AND league_id = $2 AND sent_at IS NULL AND cancelled_at IS NULL",
        announcement_id, league_id,
    )
    return result.endswith("1")


async def post_due(conn) -> int:
    """Posts every scheduled announcement whose time has come. Claims
    each row before posting (FOR UPDATE SKIP LOCKED), so two copies of
    the server can't post one twice."""
    posted = 0
    while True:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, league_id, author_user_id, title, body, notify FROM scheduled_announcements
                WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= now()
                ORDER BY send_at LIMIT 1 FOR UPDATE SKIP LOCKED
                """
            )
            if row is None:
                return posted
            message_id = await post(conn, row["league_id"], row["author_user_id"], row["title"], row["body"], row["notify"])
            await conn.execute(
                "UPDATE scheduled_announcements SET sent_at = now(), message_id = $2 WHERE id = $1", row["id"], message_id
            )
            posted += 1


async def post_waiver_results(conn, season: int, league_id: int, results: list[dict]) -> None:
    """One Commish Corner post listing every claim that won, posted as
    the league's commissioner."""
    won = [o["claim_id"] for r in results for o in r.get("outcomes", []) if o["status"] == "successful"]
    if not won:
        return
    rows = await conn.fetch(
        """
        SELECT t.team_name, pa.full_name AS player, pd.full_name AS dropped, wc.bid_amount
        FROM waiver_claims wc
        JOIN teams_by_season t ON t.id = wc.team_id
        JOIN players pa ON pa.sleeper_player_id = wc.add_sleeper_player_id
        LEFT JOIN players pd ON pd.sleeper_player_id = wc.drop_sleeper_player_id
        WHERE wc.id = ANY($1::int[])
        ORDER BY t.team_name, pa.full_name
        """,
        won,
    )
    lines = []
    for r in rows:
        line = f"{r['team_name']} claimed {r['player']}"
        if r["bid_amount"] is not None:
            line += f" for ${r['bid_amount']}"
        if r["dropped"]:
            line += f", dropped {r['dropped']}"
        lines.append(line)
    commissioner = await conn.fetchval(
        "SELECT user_id FROM league_members WHERE league_id = $1 AND role = 'commissioner' ORDER BY joined_at LIMIT 1", league_id
    )
    if commissioner is None:
        return
    try:
        await post(conn, league_id, commissioner, "Waiver results", "\n".join(lines), notify=False)
    except Exception:
        logger.exception("Couldn't post waiver results for league %s", league_id)
