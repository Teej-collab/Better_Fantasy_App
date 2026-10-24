"""
Per-league Sleeper connection storage (2026-10-24) — the Sleeper
counterpart to league_espn_connections.py. Nothing secret: Sleeper's
league API is public, so a connection is just which Sleeper league.
"""


async def list_all_connections(conn):
    return await conn.fetch("SELECT league_id, sleeper_league_id FROM league_sleeper_connections")


async def get_connection(conn, league_id: int):
    return await conn.fetchrow(
        """
        SELECT league_id, sleeper_league_id, league_name, connected_by_user_id, created_at, updated_at,
               last_synced_at, last_sync_error
        FROM league_sleeper_connections WHERE league_id = $1
        """,
        league_id,
    )


async def upsert_connection(conn, league_id: int, sleeper_league_id: str, league_name: str | None, user_id: int):
    return await conn.fetchrow(
        """
        INSERT INTO league_sleeper_connections (league_id, sleeper_league_id, league_name, connected_by_user_id, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (league_id) DO UPDATE SET
            sleeper_league_id = EXCLUDED.sleeper_league_id,
            league_name = EXCLUDED.league_name,
            connected_by_user_id = EXCLUDED.connected_by_user_id,
            updated_at = now(),
            last_synced_at = NULL,
            last_sync_error = NULL
        RETURNING league_id, sleeper_league_id, league_name
        """,
        league_id, sleeper_league_id, league_name, user_id,
    )


async def delete_connection(conn, league_id: int) -> bool:
    return (await conn.execute("DELETE FROM league_sleeper_connections WHERE league_id = $1", league_id)).endswith(" 1")


async def mark_sync_success(conn, league_id: int) -> None:
    await conn.execute(
        "UPDATE league_sleeper_connections SET last_synced_at = now(), last_sync_error = NULL WHERE league_id = $1",
        league_id,
    )


async def mark_sync_failure(conn, league_id: int, error: str) -> None:
    await conn.execute(
        "UPDATE league_sleeper_connections SET last_sync_error = $2 WHERE league_id = $1", league_id, error[:500]
    )
