"""
The matchup_narratives cache (migration 7a2c9e4b6f1d) and the
weekly_narratives cache (migration 36cc4fd982e7) — read/write for
app/domain/narrative_engine.py. See that module for the actual
generation logic; this is just the queries around both caches.
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


async def get_cached_weekly_narrative(conn, season: int, week: int, league_id: int, kind: str) -> str | None:
    return await conn.fetchval(
        "SELECT text FROM weekly_narratives WHERE season = $1 AND week = $2 AND league_id = $3 AND kind = $4",
        season, week, league_id, kind,
    )


async def save_weekly_narrative(conn, season: int, week: int, league_id: int, kind: str, text: str, model: str) -> None:
    await conn.execute(
        """
        INSERT INTO weekly_narratives (season, week, league_id, kind, text, model)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (season, week, league_id, kind)
        DO UPDATE SET text = EXCLUDED.text, model = EXCLUDED.model, generated_at = now()
        """,
        season, week, league_id, kind, text, model,
    )
