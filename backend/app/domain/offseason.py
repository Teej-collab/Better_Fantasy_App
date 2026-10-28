"""
The offseason roster lock (2026-10-28, League #1's rule, a league
setting for anyone): with leagues.offseason_lock on, nobody adds a free
agent or a rookie between the end of the season and the draft. Trades
of rostered players still go. The commissioner lifts it for a season
by "clearing" the offseason (offseason_cleared_season).
"""
MESSAGE = "No pickups in the offseason. The commissioner opens free agency when the offseason clears."


async def pickups_blocked(conn, season: int, league_id: int) -> str | None:
    """Why a pickup isn't allowed right now, or None when it is."""
    league = await conn.fetchrow("SELECT offseason_lock, offseason_cleared_season FROM leagues WHERE id = $1", league_id)
    if league is None or not league["offseason_lock"] or league["offseason_cleared_season"] == season:
        return None
    from app.domain.manager_awards import season_is_over

    if await season_is_over(conn, season, league_id):
        return MESSAGE
    status = await conn.fetchval("SELECT status FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id)
    if status != "complete":
        return MESSAGE
    return None


async def state(conn, season: int, league_id: int) -> dict:
    league = await conn.fetchrow("SELECT offseason_lock, offseason_cleared_season FROM leagues WHERE id = $1", league_id)
    return {
        "lock": bool(league and league["offseason_lock"]),
        "cleared": bool(league and league["offseason_cleared_season"] == season),
        "blocked_now": await pickups_blocked(conn, season, league_id) is not None,
    }
