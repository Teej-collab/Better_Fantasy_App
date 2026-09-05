"""Server-authoritative draft queue/wishlist (2026-09) — a personal
ranked player list per owner, scoped to one specific draft (season +
league_id, same scoping every other draft table already uses — see
migration 63291a4c50ae's own docstring for why there's no separate
"drafts" table to key off of).

This replaces frontend/src/lib/useDraftQueue.ts's old localStorage-only
queue: same UI-facing shape (an ordered list of sleeper_player_ids),
but persisted server-side so it survives a refresh/new device and so
app/domain/draft_autopick.py can actually read it. rank is a real
integer column — reordering renumbers it explicitly, never relies on
row insertion order.
"""
from app.config import DEFAULT_LEAGUE_ID


async def get_queue(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID) -> list[str]:
    """This owner's queue, ordered by rank ascending (rank 1 = top
    priority). Just the sleeper_player_id list — callers that need
    player details (name/position/etc.) already have a real player
    lookup elsewhere (GET /draft/pool), no reason to duplicate that
    here."""
    rows = await conn.fetch(
        "SELECT sleeper_player_id FROM draft_queue_items "
        "WHERE season = $1 AND league_id = $2 AND owner_id = $3 ORDER BY rank",
        season, league_id, owner_id,
    )
    return [r["sleeper_player_id"] for r in rows]


async def add_to_queue(
    conn, season: int, owner_id: int, sleeper_player_id: str, league_id: int = DEFAULT_LEAGUE_ID
) -> None:
    """Appends to the end of this owner's queue. A no-op (not an error)
    if the player's already queued — same idempotent-add convenience
    the old localStorage toggle() had."""
    async with conn.transaction():
        next_rank = await conn.fetchval(
            "SELECT COALESCE(MAX(rank), 0) + 1 FROM draft_queue_items "
            "WHERE season = $1 AND league_id = $2 AND owner_id = $3",
            season, league_id, owner_id,
        )
        await conn.execute(
            """
            INSERT INTO draft_queue_items (season, league_id, owner_id, sleeper_player_id, rank)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (season, league_id, owner_id, sleeper_player_id) DO NOTHING
            """,
            season, league_id, owner_id, sleeper_player_id, next_rank,
        )


async def remove_from_queue(
    conn, season: int, owner_id: int, sleeper_player_id: str, league_id: int = DEFAULT_LEAGUE_ID
) -> None:
    await conn.execute(
        "DELETE FROM draft_queue_items WHERE season = $1 AND league_id = $2 AND owner_id = $3 AND sleeper_player_id = $4",
        season, league_id, owner_id, sleeper_player_id,
    )


async def reorder_queue(
    conn, season: int, owner_id: int, ordered_sleeper_player_ids: list[str], league_id: int = DEFAULT_LEAGUE_ID
) -> list[str]:
    """Full reorder — the caller sends its complete desired order, and
    every rank becomes 1..N from that. Any id in the request that isn't
    actually in this owner's queue right now is silently dropped rather
    than erroring — a real, expected race: the client may have reordered
    a player that got drafted (and so queue-removed) a moment earlier,
    and the request shouldn't fail just because the world moved on.
    Returns the queue as it actually ended up (see above) so the caller
    can reconcile its own optimistic state against it.

    Renumbers in two passes — first every existing row to a disjoint
    negative range, then the real 1..N ranks — since UPDATEing straight
    to the new positive ranks one row at a time could collide with
    another row's still-old rank under the (season, league_id, owner_id,
    rank) unique constraint mid-transaction."""
    async with conn.transaction():
        existing = await conn.fetch(
            "SELECT sleeper_player_id FROM draft_queue_items WHERE season = $1 AND league_id = $2 AND owner_id = $3",
            season, league_id, owner_id,
        )
        existing_ids = {r["sleeper_player_id"] for r in existing}
        final_order = [pid for pid in ordered_sleeper_player_ids if pid in existing_ids]

        await conn.execute(
            "UPDATE draft_queue_items SET rank = -rank - 1000000 "
            "WHERE season = $1 AND league_id = $2 AND owner_id = $3",
            season, league_id, owner_id,
        )
        for rank, sleeper_player_id in enumerate(final_order, start=1):
            await conn.execute(
                "UPDATE draft_queue_items SET rank = $1 "
                "WHERE season = $2 AND league_id = $3 AND owner_id = $4 AND sleeper_player_id = $5",
                rank, season, league_id, owner_id, sleeper_player_id,
            )
    return final_order


async def remove_player_from_all_queues(
    conn, season: int, sleeper_player_id: str, league_id: int = DEFAULT_LEAGUE_ID
) -> None:
    """Called whenever a player is actually drafted (app/domain/
    draft_engine.py's make_pick) — removes that player from EVERY
    owner's queue in this draft, not just whoever picked them. Leaves
    gaps in the remaining ranks (1, 2, 4 after removing #3) rather than
    renumbering everyone else's queue on every single pick across the
    whole draft — rank is only ever read via ORDER BY, never assumed
    contiguous, so a gap is harmless and renumbering here would be
    unnecessary write volume for zero behavioral benefit."""
    await conn.execute(
        "DELETE FROM draft_queue_items WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
        season, league_id, sleeper_player_id,
    )


async def get_queue_owner_ids_for_player(
    conn, season: int, sleeper_player_id: str, league_id: int = DEFAULT_LEAGUE_ID
) -> list[int]:
    """Every owner who currently has this player queued — used to decide
    who needs a "removed from your queue" notification when the player
    gets drafted, before remove_player_from_all_queues wipes the rows
    that would otherwise answer this."""
    rows = await conn.fetch(
        "SELECT owner_id FROM draft_queue_items WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
        season, league_id, sleeper_player_id,
    )
    return [r["owner_id"] for r in rows]
