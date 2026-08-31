"""Reads over season_awards / season_champions — already populated by
Fantasy_Helper's compute pipeline (see TODO.md Phase 6: who keeps this
refreshed going forward for Better_Fantasy_App itself is still an open
question; this only reads what's there)."""

from app.config import DEFAULT_LEAGUE_ID


async def list_season_awards(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT sa.award_type, sa.detail, o.owner_id, o.display_name AS owner_name
        FROM season_awards sa
        JOIN owners o ON o.owner_id = sa.owner_id
        WHERE sa.season = $1 AND sa.league_id = $2
        ORDER BY sa.award_type
        """,
        season, league_id,
    )


async def list_owner_season_awards(conn, owner_id: int, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """Matches Fantasy_Helper's team.py embed: the season profile view
    shows "Awards This Season" as its own small list, separate from the
    career-wide grouped badges."""
    return await conn.fetch(
        "SELECT award_type, detail FROM season_awards WHERE season = $1 AND owner_id = $2 AND league_id = $3",
        season, owner_id, league_id,
    )


async def get_season_champion(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchrow(
        """
        SELECT sc.team_name, o.owner_id, o.display_name AS owner_name
        FROM season_champions sc
        JOIN owners o ON o.owner_id = sc.owner_id
        WHERE sc.season = $1 AND sc.league_id = $2
        """,
        season, league_id,
    )


async def award_win_counts(conn, league_id: int = DEFAULT_LEAGUE_ID):
    """Every owner's win count per season_awards.award_type, across every
    season — the raw material for the All-Time Records page's award
    leaderboards (app/domain/awards_all_time.py groups this by award_type
    and keeps each one's top winners). Ties (same win count) both show up
    for a type, same as records.py's top-N leaderboards."""
    return await conn.fetch(
        """
        SELECT sa.award_type, o.owner_id, o.display_name AS owner_name, COUNT(*) AS wins
        FROM season_awards sa
        JOIN owners o ON o.owner_id = sa.owner_id
        WHERE sa.league_id = $1
        GROUP BY sa.award_type, o.owner_id, o.display_name
        ORDER BY sa.award_type, wins DESC
        """,
        league_id,
    )


async def championship_win_counts(conn, league_id: int = DEFAULT_LEAGUE_ID):
    """Same idea as award_win_counts, for season_champions — a separate
    table/concept (see season_awards.py's module docstring), so it isn't
    just another award_type row to group."""
    return await conn.fetch(
        """
        SELECT o.owner_id, o.display_name AS owner_name, COUNT(*) AS wins
        FROM season_champions sc
        JOIN owners o ON o.owner_id = sc.owner_id
        WHERE sc.league_id = $1
        GROUP BY o.owner_id, o.display_name
        ORDER BY wins DESC
        """,
        league_id,
    )
