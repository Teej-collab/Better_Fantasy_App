"""
Fantasy-activity push notifications. Three events:
"your player scored a touchdown" (notify_my_players), "your starters'
NFL team is in the red zone" (notify_red_zone), and "your matchup lead
changed" (notify_fantasy_team).

Deliberately NOT sourced from Gamecast's real NFL play-by-play —
Gamecast has no fantasy-roster/lineup attribution of its own (it's
every real NFL game, not filtered to "my players"), so turning a raw
play into "did one of MY players just score" would mean re-deriving
exactly the mapping this app's own scoring pipeline already owns.
Instead, both events are detected by snapshotting the current week's
real numbers (player_week_stats' raw touchdown-stat counts and
fantasy points, matchups' home/away scores) immediately before and
after each live sync tick
(app/scheduler.py's _run_live_sync_job, which already recomputes both
during a live game) and diffing — the same numbers My Team/Matchups
already show, just watched for a change instead of only read on
request.

A push failure here must never break the sync that triggered it —
notify_fantasy_events swallows and logs its own errors, same
discipline as every other notification call site in this app.
"""
import logging
import time

from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)

_TD_KINDS = ("rush_td", "rec_td", "pass_td")
# Red zone alerts only make sense for players who could actually score
# from there — a D/ST on the team with the ball can't.
_RED_ZONE_POSITIONS = {"QB", "RB", "WR", "TE", "K"}
_BENCH_SLOTS = {"BE", "IR"}
# A team that bounces out of and back into the red zone on the same
# drive (a sack, a penalty) shouldn't buzz everyone's phone twice.
_RED_ZONE_COOLDOWN_SECONDS = 8 * 60


def _leader(home_score, away_score) -> str | None:
    """'home', 'away', or None (tied, or the game hasn't started)."""
    if home_score is None or away_score is None or home_score == away_score:
        return None
    return "home" if home_score > away_score else "away"


async def snapshot_week(conn, season: int, week: int) -> dict:
    """A cheap, pure-read snapshot of exactly what
    notify_fantasy_events needs to diff — call once before and once
    after a live sync tick recomputes the week's real numbers.

    Touchdown counts are a real-NFL fact, identical in every league, so
    they're keyed by player alone; fantasy points depend on each
    league's own scoring rules, so they're keyed by (league, player)."""
    rows = await conn.fetch(
        """
        SELECT sleeper_player_id, league_id, fantasy_points,
               COALESCE((raw_stats->>'pass_td')::float, 0) AS pass_td,
               COALESCE((raw_stats->>'rush_td')::float, 0) AS rush_td,
               COALESCE((raw_stats->>'rec_td')::float, 0) AS rec_td
        FROM player_week_stats WHERE season = $1 AND week = $2
        """,
        season, week,
    )
    matchup_rows = await conn.fetch(
        "SELECT id, home_team_id, away_team_id, home_score, away_score "
        "FROM matchups WHERE season = $1 AND week = $2",
        season, week,
    )
    td_kinds: dict[str, dict[str, float]] = {}
    points: dict[tuple, float] = {}
    for r in rows:
        td_kinds[r["sleeper_player_id"]] = {k: r[k] for k in _TD_KINDS}
        points[(r["league_id"], r["sleeper_player_id"])] = float(r["fantasy_points"] or 0)
    return {
        "week": week,
        "player_tds": {pid: sum(kinds.values()) for pid, kinds in td_kinds.items()},
        "player_td_kinds": td_kinds,
        "player_points": points,
        "matchups": {r["id"]: dict(r) for r in matchup_rows},
    }


async def notify_fantasy_events(conn, season: int, before: dict, after: dict) -> None:
    try:
        await _notify_touchdowns(conn, season, before, after)
        await _notify_lead_changes(conn, before["matchups"], after["matchups"])
    except Exception:
        logger.exception("Fantasy-activity push failed for season=%s", season)


async def _matchup_id_for_team(conn, season: int, week: int | None, team_id: int) -> int | None:
    if week is None:
        return None
    return await conn.fetchval(
        "SELECT id FROM matchups WHERE season = $1 AND week = $2 AND (home_team_id = $3 OR away_team_id = $3)",
        season, week, team_id,
    )


def _td_kind(before_kinds: dict | None, after_kinds: dict | None) -> str | None:
    """Which touchdown category just went up — the one with the biggest
    increase, in case a stat correction moved two at once."""
    if not after_kinds:
        return None
    before_kinds = before_kinds or {}
    deltas = {k: after_kinds.get(k, 0) - before_kinds.get(k, 0) for k in _TD_KINDS}
    kind, delta = max(deltas.items(), key=lambda kv: kv[1])
    return kind if delta > 0 else None


async def _notify_touchdowns(conn, season: int, before: dict, after: dict) -> None:
    before_tds, after_tds = before["player_tds"], after["player_tds"]
    scorers = [pid for pid, tds in after_tds.items() if tds > before_tds.get(pid, 0)]
    if not scorers:
        return
    week = after.get("week")
    rows = await conn.fetch(
        """
        SELECT cr.sleeper_player_id, cr.lineup_slot, cr.team_id, t.league_id,
               p.full_name AS player_name, t.owner_id, t.team_name
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN teams_by_season t ON t.id = cr.team_id
        WHERE cr.season = $1 AND cr.sleeper_player_id = ANY($2::text[])
        """,
        season, scorers,
    )
    for row in rows:
        prefs = await preferences_queries.get_preferences(conn, row["owner_id"])
        if not (prefs["push_enabled"] and prefs["notify_my_players"]):
            continue
        pid = row["sleeper_player_id"]
        key = (row["league_id"], pid)
        points_delta = None
        if key in after.get("player_points", {}):
            points_delta = after["player_points"][key] - before.get("player_points", {}).get(key, 0.0)
        await dispatcher.send_to_owner(
            conn, row["owner_id"],
            formatter.fantasy_player_touchdown(
                row["player_name"], row["team_name"],
                _td_kind(before.get("player_td_kinds", {}).get(pid), after.get("player_td_kinds", {}).get(pid)),
                points_delta,
                await _matchup_id_for_team(conn, season, week, row["team_id"]),
                on_bench=row["lineup_slot"] in _BENCH_SLOTS,
                tag=f"td-{pid}-{int(after_tds[pid])}",
            ),
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
        home_score, away_score = float(after["home_score"]), float(after["away_score"])
        for side_team, other_team, now_leading, mine, theirs in (
            (home_team, away_team, after_leader == "home", home_score, away_score),
            (away_team, home_team, after_leader == "away", away_score, home_score),
        ):
            prefs = await preferences_queries.get_preferences(conn, side_team["owner_id"])
            if prefs["push_enabled"] and prefs["notify_fantasy_team"]:
                await dispatcher.send_to_owner(
                    conn, side_team["owner_id"],
                    formatter.fantasy_matchup_lead_change(
                        now_leading, other_team["team_name"], mine, theirs, matchup_id
                    ),
                )


# In-process red zone state between scheduler ticks: which NFL teams
# were in the red zone last tick, and when each was last announced.
_red_zone_last_tick: set[str] = set()
_red_zone_last_sent: dict[str, float] = {}


def _reset_red_zone_state_for_tests() -> None:
    _red_zone_last_tick.clear()
    _red_zone_last_sent.clear()


def red_zone_entries(games: list[dict], now: float | None = None) -> list[str]:
    """NFL teams that just moved into the red zone since the previous
    call, minus any announced within the cooldown. Reads the live
    scoreboard's own possession/red-zone flags (app/providers/
    nfl_scoreboard.py) and updates the in-process state as it goes."""
    now = time.monotonic() if now is None else now
    current = {
        g["possession_team_abbr"]
        for g in games
        if g.get("state") == "in" and g.get("is_redzone") and g.get("possession_team_abbr")
    }
    entered = [
        team for team in sorted(current - _red_zone_last_tick)
        if now - _red_zone_last_sent.get(team, float("-inf")) >= _RED_ZONE_COOLDOWN_SECONDS
    ]
    _red_zone_last_tick.clear()
    _red_zone_last_tick.update(current)
    for team in entered:
        _red_zone_last_sent[team] = now
    return entered


async def notify_red_zone(conn, season: int, week: int | None, games: list[dict]) -> None:
    """One push per owner per team that just entered the red zone,
    naming that owner's own STARTERS on it (bench players can't score
    for you, so they don't earn a buzz)."""
    try:
        entered = red_zone_entries(games)
        if not entered:
            return
        rows = await conn.fetch(
            """
            SELECT p.pro_team, p.full_name AS player_name, t.owner_id, cr.team_id
            FROM current_rosters cr
            JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
            JOIN teams_by_season t ON t.id = cr.team_id
            WHERE cr.season = $1 AND p.pro_team = ANY($2::text[])
              AND cr.lineup_slot NOT IN ('BE', 'IR') AND p.position = ANY($3::text[])
            ORDER BY p.search_rank NULLS LAST, p.full_name
            """,
            season, entered, list(_RED_ZONE_POSITIONS),
        )
        grouped: dict[tuple, dict] = {}
        for r in rows:
            entry = grouped.setdefault((r["owner_id"], r["team_id"], r["pro_team"]), {"names": []})
            entry["names"].append(r["player_name"])
        for (owner_id, team_id, pro_team), entry in grouped.items():
            prefs = await preferences_queries.get_preferences(conn, owner_id)
            if not (prefs["push_enabled"] and prefs["notify_red_zone"]):
                continue
            await dispatcher.send_to_owner(
                conn, owner_id,
                formatter.fantasy_red_zone(
                    pro_team, entry["names"], await _matchup_id_for_team(conn, season, week, team_id)
                ),
            )
    except Exception:
        logger.exception("Red zone push failed for season=%s", season)
