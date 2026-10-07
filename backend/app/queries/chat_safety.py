"""
Blocking and reporting in chat (2026-10) — App Review requires both for
apps with user-generated content. See migration d6f8a0b2c4e7.
"""


async def block_owner(conn, blocker_owner_id: int, blocked_owner_id: int) -> None:
    await conn.execute(
        """
        INSERT INTO owner_blocks (blocker_owner_id, blocked_owner_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        """,
        blocker_owner_id, blocked_owner_id,
    )


async def unblock_owner(conn, blocker_owner_id: int, blocked_owner_id: int) -> None:
    await conn.execute(
        "DELETE FROM owner_blocks WHERE blocker_owner_id = $1 AND blocked_owner_id = $2",
        blocker_owner_id, blocked_owner_id,
    )


async def list_blocked(conn, blocker_owner_id: int):
    return await conn.fetch(
        """
        SELECT b.blocked_owner_id AS owner_id, o.display_name, b.created_at
        FROM owner_blocks b
        JOIN owners o ON o.owner_id = b.blocked_owner_id
        WHERE b.blocker_owner_id = $1
        ORDER BY b.created_at DESC
        """,
        blocker_owner_id,
    )


async def blocked_owner_ids(conn, blocker_owner_id: int) -> set[int]:
    rows = await conn.fetch(
        "SELECT blocked_owner_id FROM owner_blocks WHERE blocker_owner_id = $1", blocker_owner_id
    )
    return {r["blocked_owner_id"] for r in rows}


async def owners_blocking(conn, sender_owner_id: int, owner_ids: list[int]) -> set[int]:
    """Which of `owner_ids` have blocked the sender — they get no push
    for the sender's messages."""
    if not owner_ids:
        return set()
    rows = await conn.fetch(
        "SELECT blocker_owner_id FROM owner_blocks WHERE blocked_owner_id = $1 AND blocker_owner_id = ANY($2::int[])",
        sender_owner_id, owner_ids,
    )
    return {r["blocker_owner_id"] for r in rows}


async def is_blocked_either_way(conn, owner_a: int, owner_b: int) -> bool:
    return bool(
        await conn.fetchval(
            """
            SELECT 1 FROM owner_blocks
            WHERE (blocker_owner_id = $1 AND blocked_owner_id = $2)
               OR (blocker_owner_id = $2 AND blocked_owner_id = $1)
            """,
            owner_a, owner_b,
        )
    )


async def report_message(conn, message_id: int, reporter_owner_id: int, reason: str, details: str | None) -> bool:
    """Returns False if this owner already reported this message."""
    row = await conn.fetchrow(
        """
        INSERT INTO message_reports (message_id, reporter_owner_id, reason, details)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (message_id, reporter_owner_id) DO NOTHING
        RETURNING id
        """,
        message_id, reporter_owner_id, reason, details,
    )
    return row is not None
