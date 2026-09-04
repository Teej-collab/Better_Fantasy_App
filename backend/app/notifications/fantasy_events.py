"""
Fantasy-activity push notifications — the first real slice of the
event pipeline app/notifications/formatter.py's own docstring
describes ("Gamecast/fantasy event formatters... land once the event
pipeline that would actually call them is wired up"). Two events:
"your player scored a touchdown" (notify_my_players) and "your
matchup lead changed" (notify_fantasy_team).

Deliberately NOT sourced from Gamecast's real NFL play-by-play —
Gamecast has no fantasy-roster/lineup attribution of its own (it's
every real NFL game, not filtered to "my players"), so turning a raw
play into "did one of MY players just score" would mean re-deriving
exactly the mapping this app's own scoring pipeline already owns.
Instead, both events are detected by snapshotting the current week's
real numbers (player_week_stats' raw touchdown-stat counts, matchups'
home/away scores) immediately before and after each live sync tick
(app/scheduler.py's _run_live_sync_job, which already recomputes both
during a live game) and diffing — the same numbers My Team/Matchups
already show, just watched for a change instead of only read on
request.

A push failure here must never break the sync that triggered it —
notify_fantasy_events swallows and logs its own errors, same
discipline as every other notification call site in this app.
"""
import logging

from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)


def _leader(home_score, away_score) -> str | None:
    """'home', 'away', or None (tied, or the game hasn't started)."""
    if home_score is None or away_score is None or home_score == away_score:
        return None
    return "home" if home_score > away_score else "away"


async def snapshot_week(conn, season: int, week: int) -> dict:
    """A cheap, pure-read snapshot of exactly what
    notify_fantasy_events needs to diff — call once before and once
    after a live sync tick recomputes the week's real numbers."""
    td_rows = await conn.fetch(
        """
        SELECT sleeper_player_id,
               COALESCE((raw_stats->>'pass_td')::float, 0)
             + COALESCE((raw_stats->>'rush_td')::float, 0)
             + COALESCE((raw_stats->>'rec_td')::float, 0) AS tds
        FROM player_week_stats WHERE season = $1 AND week = $2
        """,
        season, week,
    )
    matchup_rows = await conn.fetch(
        "SELECT id, home_team_id, away_team_id, home_score, away_score "
        "FROM matchups WHERE season = $1 AND week = $2",
        season, week,
    )
    return {
        "player_tds": {r["sleeper_player_id"]: r["tds"] for r in td_rows},
        "matchups": {r["id"]: dict(r) for r in matchup_rows},
    }


async def notify_fantasy_events(conn, season: int, before: dict, after: dict) -> None:
    try:
        await _notify_touchdowns(conn, season, before["player_tds"], after["player_tds"])
        await _notify_lead_changes(conn, before["matchups"], after["matchups"])
    except Exception:
        logger.exception("Fantasy-activity push failed for season=%s", season)


async def _notify_touchdowns(conn, season: int, before_tds: dict, after_tds: dict) -> None:
    scorers = [pid for pid, tds in after_tds.items() if tds > before_tds.get(pid, 0)]
    if not scorers:
        return
    rows = await conn.fetch(
        """
        SELECT p.full_name AS player_name, t.owner_id, t.team_name
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN teams_by_season t ON t.id = cr.team_id
        WHERE cr.season = $1 AND cr.sleeper_player_id = ANY($2::text[])
        """,
        season, scorers,
    )
    for row in rows:
        prefs = await preferences_queries.get_preferences(conn, row["owner_id"])
        if prefs["push_enabled"] and prefs["notify_my_players"]:
            await dispatcher.send_to_owner(
                conn, row["owner_id"], formatter.fantasy_player_touchdown(row["player_name"], row["team_name"])
            )


async def _notify_lead_changes(conn, before_matchups: dict, after_matchups: dict) -> None:
    for matchup_id, after in after_matchups.items():
        before = before_matchups.get(matchup_id)
        if before is None:
            continue
        after_leader = _leader(after["home_score"], after["away_score"])
        if after_leader is None:
            continue  # tied (or not started) after this tick — nothing to announce
        if _leader(before["home_score"], before["away_score"]) == after_leader:
            continue  # same leader as before this tick — no real change

        home_team = await conn.fetchrow(
            "SELECT owner_id, team_name FROM teams_by_season WHERE id = $1", after["home_team_id"]
        )
        away_team = await conn.fetchrow(
            "SELECT owner_id, team_name FROM teams_by_season WHERE id = $1", after["away_team_id"]
        )
        for side_team, other_team, now_leading in (
            (home_team, away_team, after_leader == "home"),
            (away_team, home_team, after_leader == "away"),
        ):
            prefs = await preferences_queries.get_preferences(conn, side_team["owner_id"])
            if prefs["push_enabled"] and prefs["notify_fantasy_team"]:
                await dispatcher.send_to_owner(
                    conn, side_team["owner_id"],
                    formatter.fantasy_matchup_lead_change(now_leading, other_team["team_name"]),
                )
