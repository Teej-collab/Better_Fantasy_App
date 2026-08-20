"""League chat reads/writes — see app/routers/chat.py."""


async def insert_message(conn, owner_id: int, body: str):
    return await conn.fetchrow(
        "INSERT INTO messages (owner_id, body) VALUES ($1, $2) RETURNING id, owner_id, body, created_at",
        owner_id, body,
    )


async def list_recent_messages(conn, limit: int = 50):
    rows = await conn.fetch(
        """
        SELECT m.id, m.owner_id, o.display_name AS owner_name, m.body, m.created_at
        FROM messages m
        JOIN owners o ON o.owner_id = m.owner_id
        ORDER BY m.created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return list(reversed(rows))  # oldest first, matching how a chat log reads top to bottom
