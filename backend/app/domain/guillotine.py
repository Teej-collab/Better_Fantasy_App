"""
Guillotine leagues (league formats, 2026-10): every week, once that
week's games are final, the team still alive with the lowest score is
cut. Its whole roster goes to waivers (bid on with FAAB — waivers.py),
and the last team left wins.

A week's team scores are the ones already stored on that week's
matchups (every team still plays a schedule game; the pairing itself
just doesn't decide anything). A tie for the lowest score goes against
the team with fewer season points, then the higher team id, so the
same week always cuts the same team.

Idempotent: one elimination per (league, season, week) — the unique
key — so the settlement job can call this on every tick.
"""
import logging

from app.domain.league_format import get_league_format
from app.domain.waivers import start_waiver_clock
from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)


async def eliminated_teams(conn, season: int, league_id: int) -> dict[int, int]:
    """{team_id: week cut}."""
    rows = await conn.fetch(
        "SELECT team_id, week FROM guillotine_eliminations WHERE season = $1 AND league_id = $2", season, league_id
    )
    return {r["team_id"]: r["week"] for r in rows}


def pick_cut(week_points: dict[int, float], season_points: dict[int, float]) -> int:
    """The team cut this week: lowest score, then fewest season points,
    then the higher team id."""
    return min(week_points, key=lambda t: (week_points[t], season_points.get(t, 0.0), -t))


async def eliminate_for_week(conn, season: int, week: int, league_id: int) -> dict | None:
    """Cuts this week's team in a guillotine league. Returns the cut
    ({team_id, team_name, points, survivors}), or None when there's
    nothing to do (not a guillotine league, already cut this week, no
    scores, or a champion already decided)."""
    if (await get_league_format(conn, league_id))["league_type"] != "guillotine":
        return None
    if await conn.fetchval(
        "SELECT 1 FROM guillotine_eliminations WHERE league_id = $1 AND season = $2 AND week = $3",
        league_id, season, week,
    ):
        return None
    out = await eliminated_teams(conn, season, league_id)
    teams = await conn.fetch(
        "SELECT id, team_name FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    )
    alive = {t["id"]: t["team_name"] for t in teams if t["id"] not in out}
    if len(alive) <= 1:
        return None

    scores = await conn.fetch(
        """
        SELECT week, home_team_id AS team_id, home_score AS points FROM matchups
        WHERE season = $1 AND league_id = $2 AND week <= $3 AND is_playoff = FALSE
        UNION ALL
        SELECT week, away_team_id, away_score FROM matchups
        WHERE season = $1 AND league_id = $2 AND week <= $3 AND is_playoff = FALSE
        """,
        season, league_id, week,
    )
    week_points = {
        r["team_id"]: float(r["points"] or 0) for r in scores if r["week"] == week and r["team_id"] in alive
    }
    if len(week_points) < len(alive):
        # A surviving team with no game on the books this week: nothing
        # fair to compare, so don't cut anyone.
        logger.warning("Guillotine week %s league %s: not every surviving team has a score", week, league_id)
        return None
    season_points: dict[int, float] = {}
    for r in scores:
        season_points[r["team_id"]] = season_points.get(r["team_id"], 0.0) + float(r["points"] or 0)

    cut = pick_cut(week_points, season_points)
    async with conn.transaction():
        inserted = await conn.fetchval(
            """
            INSERT INTO guillotine_eliminations (league_id, season, week, team_id, week_points)
            VALUES ($1, $2, $3, $4, $5::numeric(10,2)) ON CONFLICT DO NOTHING RETURNING id
            """,
            league_id, season, week, cut, week_points[cut],
        )
        if inserted is None:
            return None
        released = await conn.fetch(
            "DELETE FROM current_rosters WHERE season = $1 AND league_id = $2 AND team_id = $3 RETURNING sleeper_player_id",
            season, league_id, cut,
        )
        for r in released:
            await start_waiver_clock(conn, season, league_id, r["sleeper_player_id"])
        await conn.execute(
            "UPDATE waiver_claims SET status = 'failed', failure_reason = $1, processed_at = now() "
            "WHERE season = $2 AND league_id = $3 AND team_id = $4 AND status = 'pending'",
            "Your team was eliminated", season, league_id, cut,
        )

    survivors = len(alive) - 1
    result = {"team_id": cut, "team_name": alive[cut], "points": week_points[cut], "survivors": survivors}
    await _notify(conn, season, league_id, formatter.guillotine_cut(alive[cut], week, week_points[cut], survivors))
    logger.info("Guillotine cut (league_id=%s season=%s week=%s): %s", league_id, season, week, result)
    return result


async def _notify(conn, season: int, league_id: int, payload: dict) -> None:
    owners = await conn.fetch(
        "SELECT DISTINCT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    )
    for row in owners:
        try:
            prefs = await preferences_queries.get_preferences(conn, row["owner_id"])
            if prefs["push_enabled"] and prefs["notify_league"]:
                await dispatcher.send_to_owner(conn, row["owner_id"], payload)
        except Exception:
            logger.exception("Guillotine push failed (owner_id=%s)", row["owner_id"])
