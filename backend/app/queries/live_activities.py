"""
Live Activity push tokens (migration e8a0c2d4f6b9) — the lock-screen and
Dynamic Island live score on iOS.
"""


async def upsert_activity_token(
    conn, owner_id: int, league_id: int, device_id: str, token: str, activity_id: str | None, matchup_id: int | None,
    asset_dir: str | None = None,
):
    """A running Live Activity's update token. iOS can reissue it, so a
    repeat of the same activity replaces the old token instead of adding
    a second row."""
    if activity_id:
        await conn.execute(
            "UPDATE live_activity_tokens SET active = FALSE, updated_at = now() "
            "WHERE kind = 'activity' AND owner_id = $1 AND activity_id = $2 AND token <> $3",
            owner_id, activity_id, token,
        )
    await conn.execute(
        """
        INSERT INTO live_activity_tokens (owner_id, league_id, device_id, kind, token, activity_id, matchup_id, asset_dir)
        VALUES ($1, $2, $3, 'activity', $4, $5, $6, $7)
        ON CONFLICT (token) DO UPDATE SET
            owner_id = EXCLUDED.owner_id, league_id = EXCLUDED.league_id, device_id = EXCLUDED.device_id,
            activity_id = EXCLUDED.activity_id, matchup_id = EXCLUDED.matchup_id,
            asset_dir = COALESCE(EXCLUDED.asset_dir, live_activity_tokens.asset_dir),
            active = TRUE, updated_at = now()
        """,
        owner_id, league_id, device_id, token, activity_id, matchup_id, asset_dir,
    )


async def upsert_start_token(conn, owner_id: int, league_id: int, device_id: str, token: str, asset_dir: str | None = None):
    """The device's push-to-start token — one per device and account."""
    await conn.execute(
        "DELETE FROM live_activity_tokens WHERE token = $1 AND NOT (owner_id = $2 AND device_id = $3 AND kind = 'start')",
        token, owner_id, device_id,
    )
    await conn.execute(
        """
        INSERT INTO live_activity_tokens (owner_id, league_id, device_id, kind, token, asset_dir)
        VALUES ($1, $2, $3, 'start', $4, $5)
        ON CONFLICT (owner_id, device_id) WHERE kind = 'start' DO UPDATE SET
            token = EXCLUDED.token, league_id = EXCLUDED.league_id,
            asset_dir = COALESCE(EXCLUDED.asset_dir, live_activity_tokens.asset_dir),
            active = TRUE, updated_at = now()
        """,
        owner_id, league_id, device_id, token, asset_dir,
    )


async def end_activity(conn, owner_id: int, activity_id: str) -> None:
    await conn.execute(
        "UPDATE live_activity_tokens SET active = FALSE, updated_at = now() "
        "WHERE kind = 'activity' AND owner_id = $1 AND activity_id = $2",
        owner_id, activity_id,
    )


async def deactivate_device(conn, owner_id: int, device_id: str) -> None:
    """Signing out on a device: no more lock-screen updates or remote
    starts for that account there."""
    await conn.execute(
        "UPDATE live_activity_tokens SET active = FALSE, updated_at = now() WHERE owner_id = $1 AND device_id = $2",
        owner_id, device_id,
    )


async def deactivate_token(conn, token_id: int) -> None:
    await conn.execute("UPDATE live_activity_tokens SET active = FALSE, updated_at = now() WHERE id = $1", token_id)


async def list_active(conn, kind: str):
    return await conn.fetch(
        "SELECT * FROM live_activity_tokens WHERE active AND kind = $1 ORDER BY owner_id, id", kind
    )


async def record_sent(conn, token_id: int, props_json: str) -> None:
    await conn.execute(
        "UPDATE live_activity_tokens SET last_props = $2, last_sent_at = now(), updated_at = now() WHERE id = $1",
        token_id, props_json,
    )


async def has_active_activity(conn, owner_id: int, matchup_id: int) -> bool:
    return bool(
        await conn.fetchval(
            "SELECT 1 FROM live_activity_tokens WHERE active AND kind = 'activity' AND owner_id = $1 AND matchup_id = $2",
            owner_id, matchup_id,
        )
    )


async def claim_remote_start(conn, owner_id: int, matchup_id: int) -> bool:
    """True the first time only — a matchup is started remotely at most once."""
    row = await conn.fetchrow(
        "INSERT INTO live_activity_remote_starts (owner_id, matchup_id) VALUES ($1, $2) "
        "ON CONFLICT DO NOTHING RETURNING owner_id",
        owner_id, matchup_id,
    )
    return row is not None
