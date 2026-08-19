"""Reads over season_awards / season_champions — already populated by
Fantasy_Helper's compute pipeline (see TODO.md Phase 6: who keeps this
refreshed going forward for Better_Fantasy_App itself is still an open
question; this only reads what's there)."""


async def list_season_awards(conn, season: int):
    return await conn.fetch(
        """
        SELECT sa.award_type, sa.detail, o.owner_id, o.display_name AS owner_name
        FROM season_awards sa
        JOIN owners o ON o.owner_id = sa.owner_id
        WHERE sa.season = $1
        ORDER BY sa.award_type
        """,
        season,
    )


async def list_owner_season_awards(conn, owner_id: int, season: int):
    """Matches Fantasy_Helper's team.py embed: the season profile view
    shows "Awards This Season" as its own small list, separate from the
    career-wide grouped badges."""
    return await conn.fetch(
        "SELECT award_type, detail FROM season_awards WHERE season = $1 AND owner_id = $2",
        season, owner_id,
    )


async def get_season_champion(conn, season: int):
    return await conn.fetchrow(
        """
        SELECT sc.team_name, o.owner_id, o.display_name AS owner_name
        FROM season_champions sc
        JOIN owners o ON o.owner_id = sc.owner_id
        WHERE sc.season = $1
        """,
        season,
    )
