"""Self-serve user settings — display name and chat bubble color. Every
query here is scoped to a single owner_id supplied by the caller, which
app/routers/settings.py always takes from the signed-in session, never
from a URL param or request body — an owner can only ever read or write
their own row through this module."""


async def get_settings(conn, owner_id: int, active_season: int):
    return await conn.fetchrow(
        """
        SELECT o.display_name, o.display_name_is_custom, o.chat_color, u.discord_username,
            t.team_name, t.team_name_is_custom
        FROM owners o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN teams_by_season t ON t.owner_id = o.owner_id AND t.season = $2
        WHERE o.owner_id = $1
        """,
        owner_id, active_season,
    )


async def set_display_name(conn, owner_id: int, display_name: str):
    await conn.execute(
        "UPDATE owners SET display_name = $2, display_name_is_custom = TRUE WHERE owner_id = $1",
        owner_id, display_name,
    )


async def reset_display_name(conn, owner_id: int):
    """Clears the override — the next ESPN sync naturally restores the
    real name (see app/providers/espn/adapter.py), so nothing needs to
    be looked up or copied back here."""
    await conn.execute("UPDATE owners SET display_name_is_custom = FALSE WHERE owner_id = $1", owner_id)


async def set_chat_color(conn, owner_id: int, chat_color: str | None):
    """chat_color=None resets to the app's default bubble color."""
    await conn.execute("UPDATE owners SET chat_color = $2 WHERE owner_id = $1", owner_id, chat_color)


async def get_team_name(conn, owner_id: int, season: int):
    return await conn.fetchval(
        "SELECT team_name FROM teams_by_season WHERE owner_id = $1 AND season = $2",
        owner_id, season,
    )


async def set_team_name(conn, owner_id: int, season: int, team_name: str) -> bool:
    """Returns False if this owner has no team row for `season` (e.g. a
    new owner ESPN hasn't synced yet) — the caller turns that into a 404
    rather than silently updating zero rows."""
    result = await conn.execute(
        "UPDATE teams_by_season SET team_name = $3, team_name_is_custom = TRUE WHERE owner_id = $1 AND season = $2",
        owner_id, season, team_name,
    )
    return result != "UPDATE 0"


async def reset_team_name(conn, owner_id: int, season: int):
    """Clears the override — the next ESPN sync naturally restores the
    real name (see app/providers/espn/adapter.py), same as
    reset_display_name above."""
    await conn.execute(
        "UPDATE teams_by_season SET team_name_is_custom = FALSE WHERE owner_id = $1 AND season = $2",
        owner_id, season,
    )
