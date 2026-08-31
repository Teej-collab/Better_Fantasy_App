"""
The matchup_narratives cache (migration 7a2c9e4b6f1d) — read/write for
app/domain/narrative_engine.py. See that module for the actual
generation logic; this is just the two queries around it.
"""


async def get_cached_narrative(conn, matchup_id: int, kind: str) -> str | None:
    return await conn.fetchval(
        "SELECT text FROM matchup_narratives WHERE matchup_id = $1 AND kind = $2",
        matchup_id, kind,
    )


async def save_narrative(conn, matchup_id: int, kind: str, text: str, model: str) -> None:
    # ON CONFLICT rather than a plain INSERT: two concurrent requests
    # for the same never-yet-cached matchup could both miss the cache
    # and both generate — harmless to spend an extra API call once in a
    # while, but the second write should just take the row, not 23505.
    await conn.execute(
        """
        INSERT INTO matchup_narratives (matchup_id, kind, text, model)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (matchup_id, kind) DO UPDATE SET text = EXCLUDED.text, model = EXCLUDED.model, generated_at = now()
        """,
        matchup_id, kind, text, model,
    )
