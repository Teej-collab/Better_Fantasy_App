"""Plain CRUD/tally SQL for league_polls/poll_votes (app/routers/polls.py)
— see that migration's own docstring for the schema shape and why
voting is keyed by user_id, not owner_id."""
import json


async def create_poll(conn, league_id: int, question: str, options: list[str], created_by_user_id: int) -> dict:
    row = await conn.fetchrow(
        """
        INSERT INTO league_polls (league_id, question, options, created_by_user_id)
        VALUES ($1, $2, $3, $4) RETURNING *
        """,
        league_id, question, json.dumps(options), created_by_user_id,
    )
    return dict(row)


async def get_poll(conn, league_id: int, poll_id: int) -> dict | None:
    row = await conn.fetchrow(
        "SELECT * FROM league_polls WHERE id = $1 AND league_id = $2", poll_id, league_id
    )
    return dict(row) if row else None


async def list_polls(conn, league_id: int) -> list[dict]:
    rows = await conn.fetch(
        "SELECT * FROM league_polls WHERE league_id = $1 ORDER BY created_at DESC", league_id
    )
    return [dict(r) for r in rows]


async def close_poll(conn, league_id: int, poll_id: int) -> dict | None:
    row = await conn.fetchrow(
        """
        UPDATE league_polls SET status = 'closed', closed_at = now()
        WHERE id = $1 AND league_id = $2 AND status = 'open' RETURNING *
        """,
        poll_id, league_id,
    )
    return dict(row) if row else None


async def cast_vote(conn, poll_id: int, user_id: int, option_index: int) -> None:
    """Upsert — a member can change their vote any time while the poll
    stays open (the caller checks that; this just replaces whatever
    vote, if any, is already on file)."""
    await conn.execute(
        """
        INSERT INTO poll_votes (poll_id, user_id, option_index)
        VALUES ($1, $2, $3)
        ON CONFLICT (poll_id, user_id) DO UPDATE SET option_index = EXCLUDED.option_index, voted_at = now()
        """,
        poll_id, user_id, option_index,
    )


async def get_vote_counts(conn, poll_id: int) -> dict[int, int]:
    rows = await conn.fetch(
        "SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE poll_id = $1 GROUP BY option_index",
        poll_id,
    )
    return {r["option_index"]: r["n"] for r in rows}


async def get_vote_counts_for_polls(conn, poll_ids: list[int]) -> dict[int, dict[int, int]]:
    """Batched counterpart to get_vote_counts — one query for list_polls'
    whole page instead of one round-trip per poll."""
    if not poll_ids:
        return {}
    rows = await conn.fetch(
        "SELECT poll_id, option_index, COUNT(*) AS n FROM poll_votes WHERE poll_id = ANY($1::int[]) "
        "GROUP BY poll_id, option_index",
        poll_ids,
    )
    counts: dict[int, dict[int, int]] = {pid: {} for pid in poll_ids}
    for r in rows:
        counts[r["poll_id"]][r["option_index"]] = r["n"]
    return counts


async def get_my_votes(conn, poll_ids: list[int], user_id: int) -> dict[int, int]:
    """poll_id -> the caller's own chosen option_index, for whichever of
    poll_ids they've voted on."""
    if not poll_ids:
        return {}
    rows = await conn.fetch(
        "SELECT poll_id, option_index FROM poll_votes WHERE poll_id = ANY($1::int[]) AND user_id = $2",
        poll_ids, user_id,
    )
    return {r["poll_id"]: r["option_index"] for r in rows}
