"""
Per-league ESPN connection storage (Phase 6 of the multi-league
migration — see TODO.md's PHASE 9 entry). One row per league_id at
most — see migration 0abe0690feb3 for why league_id is the PRIMARY KEY
rather than a separate id + UNIQUE constraint. Callers decrypt/encrypt
via app/encryption.py; this module only ever moves ciphertext.
"""


async def list_all_connections(conn):
    """Every league with a saved ESPN connection — the scheduled sync
    jobs (app/scheduler.py) iterate this to sync each independently of
    League #1's own env-var-driven sync, not filtered by anything
    beyond "has a connection at all" (a disconnected league just isn't
    a row here anymore, see delete_connection)."""
    return await conn.fetch(
        "SELECT league_id, espn_league_id, espn_s2_encrypted, espn_swid_encrypted FROM league_espn_connections"
    )


async def get_connection(conn, league_id: int):
    return await conn.fetchrow(
        """
        SELECT league_id, espn_league_id, espn_s2_encrypted, espn_swid_encrypted,
               connected_by_user_id, created_at, updated_at, last_synced_at, last_sync_error
        FROM league_espn_connections
        WHERE league_id = $1
        """,
        league_id,
    )


async def upsert_connection(
    conn, league_id: int, espn_league_id: int, espn_s2_encrypted: str, espn_swid_encrypted: str,
    connected_by_user_id: int,
):
    """Reconnecting (new credentials for a league that already had a
    connection) replaces the row in place, including clearing any
    stale last_sync_error from before — the same rationale
    native_push_tokens.upsert_registration gives for reviving a
    deactivated row rather than leaving old failure state visible next
    to credentials that haven't even been tried yet."""
    return await conn.fetchrow(
        """
        INSERT INTO league_espn_connections
            (league_id, espn_league_id, espn_s2_encrypted, espn_swid_encrypted, connected_by_user_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (league_id) DO UPDATE SET
            espn_league_id = EXCLUDED.espn_league_id,
            espn_s2_encrypted = EXCLUDED.espn_s2_encrypted,
            espn_swid_encrypted = EXCLUDED.espn_swid_encrypted,
            connected_by_user_id = EXCLUDED.connected_by_user_id,
            updated_at = now(),
            last_synced_at = NULL,
            last_sync_error = NULL
        RETURNING league_id, espn_league_id, created_at, updated_at
        """,
        league_id, espn_league_id, espn_s2_encrypted, espn_swid_encrypted, connected_by_user_id,
    )


async def delete_connection(conn, league_id: int) -> bool:
    result = await conn.execute("DELETE FROM league_espn_connections WHERE league_id = $1", league_id)
    return result.endswith(" 1")


async def mark_sync_success(conn, league_id: int) -> None:
    await conn.execute(
        "UPDATE league_espn_connections SET last_synced_at = now(), last_sync_error = NULL WHERE league_id = $1",
        league_id,
    )


async def mark_sync_failure(conn, league_id: int, error: str) -> None:
    # last_synced_at deliberately untouched on failure — it should keep
    # reflecting the last time a sync actually succeeded, not this
    # attempt, so a commissioner can tell "never worked" apart from
    # "worked before, broken now."
    await conn.execute(
        "UPDATE league_espn_connections SET last_sync_error = $2 WHERE league_id = $1",
        league_id, error,
    )
