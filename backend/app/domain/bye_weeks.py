"""
Team-level (not per-player) bye week derivation — every player on the
same real NFL team shares one bye week each season, so this is 32
answers, not one per rostered player. Derived from the same public,
keyless NFL scoreboard endpoint already in production use
(app/providers/nfl_scoreboard.py) rather than ESPN's private league API
or a per-player live lookup (app/providers/espn/player_info.py's
bye_week field, which needs an espn_player_id crosswalk only ~22% of
players have and is far too slow to run for a whole roster).

Computed once (18 real HTTP calls, one per regular-season week) and
cached in team_bye_weeks — see app/routers/admin.py's
POST /admin/sync/bye-weeks for the commissioner-triggered refresh path.
Real NFL bye weeks are set once at schedule release and don't change
mid-season, so this doesn't need a continuous scheduler.
"""
from app.providers.espn.player_info import REGULAR_SEASON_WEEKS
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.providers.sleeper.teams import TEAM_NAMES


async def compute_bye_weeks(season: int) -> dict[str, int]:
    """Returns {pro_team_abbr: bye_week}. A team missing from every
    week's scoreboard (a real gap in ESPN's data, or a mid-computation
    partial failure) simply isn't included rather than guessed."""
    teams_seen_by_week: dict[int, set[str]] = {}
    for week in range(1, REGULAR_SEASON_WEEKS + 1):
        games = await get_week_scoreboard(week, season)
        seen: set[str] = set()
        for game in games:
            if game.get("home_team"):
                seen.add(game["home_team"])
            if game.get("away_team"):
                seen.add(game["away_team"])
        teams_seen_by_week[week] = seen

    bye_weeks: dict[str, int] = {}
    for team in TEAM_NAMES:
        missing_weeks = [week for week, seen in teams_seen_by_week.items() if team not in seen]
        # Exactly one bye week is the real, expected case. Zero means
        # this team appeared in every fetched week (a real possibility
        # this early in a season if some weeks aren't scheduled yet) —
        # skip rather than guess. More than one is a real data gap
        # (partial scoreboard fetch failure) — same treatment, don't
        # guess which one is the actual bye.
        if len(missing_weeks) == 1:
            bye_weeks[team] = missing_weeks[0]
    return bye_weeks


async def sync_bye_weeks(conn, season: int) -> int:
    """Computes and upserts — see POST /admin/sync/bye-weeks. Returns
    the number of teams written (32 in the real, complete case)."""
    bye_weeks = await compute_bye_weeks(season)
    async with conn.transaction():
        await conn.executemany(
            """
            INSERT INTO team_bye_weeks (season, pro_team, bye_week, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (season, pro_team) DO UPDATE SET
                bye_week = EXCLUDED.bye_week,
                updated_at = now()
            """,
            [(season, team, week) for team, week in bye_weeks.items()],
        )
    return len(bye_weeks)
