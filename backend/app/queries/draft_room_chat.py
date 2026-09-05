"""
Persisted chat for the draft room (2026-09) — real typed messages only,
scoped to one specific draft (season + league_id, same scoping every
other draft table uses — see draft_room_messages' own migration
docstring, de2815ccf477). Deliberately separate from app/queries/
chat.py's general conversations/messages system: this is much simpler
draft-night banter with no reactions, mentions, edits, or read receipts,
and scoping it to a draft rather than a conversation would fight that
system's own model rather than reuse it. "Who's online" is never
stored here — that stays the existing real-time-only presence system,
app/draft/manager.py.
"""

MAX_MESSAGE_LENGTH = 500


async def insert_message(conn, season: int, league_id: int, owner_id: int, text: str) -> dict:
    row = await conn.fetchrow(
        """
        INSERT INTO draft_room_messages (season, league_id, owner_id, text)
        VALUES ($1, $2, $3, $4)
        RETURNING id, season, league_id, owner_id, text, created_at
        """,
        season, league_id, owner_id, text,
    )
    owner_name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)
    return {**dict(row), "owner_name": owner_name or "Someone"}


async def get_recent_messages(conn, season: int, league_id: int, limit: int = 100) -> list[dict]:
    """Oldest-first, capped to the most recent `limit` — enough history
    for a late-joining or reconnecting owner without an unbounded read
    (draft-night chat volume is naturally low, so this ceiling should
    never actually bind in practice)."""
    rows = await conn.fetch(
        """
        SELECT m.id, m.season, m.league_id, m.owner_id, o.display_name AS owner_name, m.text, m.created_at
        FROM draft_room_messages m
        JOIN owners o ON o.owner_id = m.owner_id
        WHERE m.season = $1 AND m.league_id = $2
        ORDER BY m.created_at DESC
        LIMIT $3
        """,
        season, league_id, limit,
    )
    return [dict(r) for r in reversed(rows)]
