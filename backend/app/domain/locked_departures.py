"""
A starter who already played this week keeps scoring for the team that
started them, even after leaving the roster mid-week — ESPN's rule.

Real report 2026-10-12: a waiver claim processed Monday at 3am ET (the
daily run — app/domain/waivers.py) dropped the Dallas D/ST that had
started and played Sunday. The current week's score reads the live
roster (league_queries.get_current_roster) and its roster_history
snapshot mirrors the live roster too, so the D/ST's points left the
week-5 matchup with it.

Every path that takes a player off a roster mid-week (a waiver claim's
drop, a plain drop, a free-agent add's drop, a trade) calls
keep_if_played first. If the player sat in a starting slot and their
game has kicked off this week, a locked_departures row keeps them in
that slot for this week only: the current-week roster reads and the
week's roster_history snapshot include them (so the score and the
matchup screen do), and the slot counts as occupied and locked
(lineup_engine._find_displacement), so it can't be filled twice.
"""
from app.domain.nfl_schedule import locked_pro_teams
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.queries import league as league_queries

_NON_STARTER_SLOTS = ("BE", "IR", "TAXI")


async def _has_played(conn, season: int, week: int, league_id: int, sleeper_player_id: str, pro_team: str | None) -> bool:
    """Their team's game has kicked off (ESPN's scoreboard, the same
    lock the lineup uses), or — if the scoreboard can't be reached —
    they already have points this week."""
    try:
        if pro_team and pro_team in locked_pro_teams(await get_week_scoreboard(week, season)):
            return True
    except Exception:
        pass
    points = await conn.fetchval(
        "SELECT fantasy_points FROM player_week_stats WHERE season = $1 AND week = $2 AND league_id = $3 AND sleeper_player_id = $4",
        season, week, league_id, sleeper_player_id,
    )
    return points is not None and float(points) != 0.0


async def keep_if_played(conn, season: int, league_id: int, team_id: int, sleeper_player_id: str) -> bool:
    """Call just before removing a player from `team_id`'s roster. True
    when they were kept for this week's lineup."""
    row = await conn.fetchrow(
        """
        SELECT cr.lineup_slot, p.pro_team
        FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND cr.team_id = $2 AND cr.sleeper_player_id = $3
        """,
        season, team_id, sleeper_player_id,
    )
    if row is None or row["lineup_slot"] in _NON_STARTER_SLOTS:
        return False
    week = await league_queries.get_cached_current_week(conn, season)
    if week is None or not await _has_played(conn, season, week, league_id, sleeper_player_id, row["pro_team"]):
        return False
    await conn.execute(
        """
        INSERT INTO locked_departures (season, week, league_id, team_id, sleeper_player_id, lineup_slot)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (season, week, team_id, sleeper_player_id) DO UPDATE SET lineup_slot = EXCLUDED.lineup_slot
        """,
        season, week, league_id, team_id, sleeper_player_id, row["lineup_slot"],
    )
    return True
