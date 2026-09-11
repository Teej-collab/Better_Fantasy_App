"""
Ported from Fantasy_Helper's bot/stats_engine/bench_crime.py (detection
rule, unchanged) and scripts/compute_bench_crimes.py (the write-side
script — see MIGRATION_MAP.md).

A bench player commits a "crime" if they outscore a starter at the SAME
true position (position, not lineup_slot — FLEX can obscure a starter's
real position). Every matching starter is checked, so beating multiple
starters at once produces multiple crime records for the same bench
player. bench_crimes has no unique constraint on (season, week, team_id)
— a team can have zero, one, or several crimes in a given week — so
recomputing a week deletes and re-inserts that team's rows rather than
upserting, same as the original script.
"""


from app.config import DEFAULT_LEAGUE_ID
from app.domain.roster_source import uses_in_app_rosters


def classify_severity(points_diff: float) -> str:
    if points_diff >= 30:
        return "Felony Bench Crime"
    elif points_diff >= 20:
        return "High Misdemeanor"
    elif points_diff >= 10:
        return "Low Misdemeanor"
    else:
        return "Minor Infraction"


def detect_bench_crimes(roster_rows: list[dict]) -> list[dict]:
    starters = [r for r in roster_rows if r["lineup_slot"] not in ("BE", "IR")]
    bench = [r for r in roster_rows if r["lineup_slot"] == "BE"]

    crimes = []
    for b in bench:
        b_pts = b["points_scored"] or 0
        matching_starters = [s for s in starters if s["position"] == b["position"]]

        for s in matching_starters:
            s_pts = s["points_scored"] or 0
            if b_pts > s_pts:
                diff = round(b_pts - s_pts, 2)
                crimes.append(
                    {
                        "bench_player": b["player_name"],
                        "started_player": s["player_name"],
                        "position": b["position"],
                        "points_diff": diff,
                        "severity": classify_severity(diff),
                    }
                )

    return crimes


async def compute_bench_crimes_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    in_app = await uses_in_app_rosters(conn, season)
    if in_app:
        team_rows = await conn.fetch(
            "SELECT DISTINCT team_id FROM roster_history WHERE season = $1 AND week = $2", season, week
        )
    else:
        team_rows = await conn.fetch(
            "SELECT DISTINCT team_id FROM rosters WHERE season = $1 AND week = $2 AND league_id = $3",
            season, week, league_id,
        )

    total_crimes = 0
    for t in team_rows:
        team_id = t["team_id"]
        if in_app:
            rows = await conn.fetch(
                """
                SELECT p.full_name AS player_name, p.position, rh.lineup_slot,
                       pws.fantasy_points AS points_scored
                FROM roster_history rh
                JOIN players p ON p.sleeper_player_id = rh.sleeper_player_id
                LEFT JOIN player_week_stats pws
                    ON pws.season = rh.season AND pws.week = rh.week AND pws.sleeper_player_id = rh.sleeper_player_id
                    AND pws.league_id = $4
                WHERE rh.season = $1 AND rh.week = $2 AND rh.team_id = $3
                """,
                season, week, team_id, league_id,
            )
        else:
            rows = await conn.fetch(
                "SELECT player_name, position, lineup_slot, points_scored FROM rosters "
                "WHERE season = $1 AND week = $2 AND team_id = $3 AND league_id = $4",
                season, week, team_id, league_id,
            )
        crimes = detect_bench_crimes([dict(r) for r in rows])

        await conn.execute(
            "DELETE FROM bench_crimes WHERE season = $1 AND week = $2 AND team_id = $3 AND league_id = $4",
            season, week, team_id, league_id,
        )
        for crime in crimes:
            await conn.execute(
                """
                INSERT INTO bench_crimes
                    (season, week, team_id, bench_player, started_player, position, points_diff, severity, league_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                season, week, team_id,
                crime["bench_player"], crime["started_player"], crime["position"],
                crime["points_diff"], crime["severity"], league_id,
            )
        total_crimes += len(crimes)

    return total_crimes


async def compute_bench_crimes_for_season(pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    async with pool.acquire() as conn:
        if await uses_in_app_rosters(conn, season):
            weeks = await conn.fetch(
                "SELECT DISTINCT week FROM roster_history WHERE season = $1 ORDER BY week", season
            )
        else:
            weeks = await conn.fetch(
                "SELECT DISTINCT week FROM rosters WHERE season = $1 AND league_id = $2 ORDER BY week",
                season, league_id,
            )
        total = 0
        for w in weeks:
            total += await compute_bench_crimes_for_week(conn, season, w["week"], league_id)
    return total


async def compute_bench_crimes_for_single_week(pool, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Pool-based single-week entry point for live sync (see
    app/providers/sync.py's run_live_sync)."""
    async with pool.acquire() as conn:
        return await compute_bench_crimes_for_week(conn, season, week, league_id)
