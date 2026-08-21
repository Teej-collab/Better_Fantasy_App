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


async def compute_bench_crimes_for_week(conn, season: int, week: int) -> int:
    team_rows = await conn.fetch(
        "SELECT DISTINCT team_id FROM rosters WHERE season = $1 AND week = $2", season, week
    )

    total_crimes = 0
    for t in team_rows:
        team_id = t["team_id"]
        rows = await conn.fetch(
            "SELECT player_name, position, lineup_slot, points_scored FROM rosters "
            "WHERE season = $1 AND week = $2 AND team_id = $3",
            season, week, team_id,
        )
        crimes = detect_bench_crimes([dict(r) for r in rows])

        await conn.execute(
            "DELETE FROM bench_crimes WHERE season = $1 AND week = $2 AND team_id = $3", season, week, team_id
        )
        for crime in crimes:
            await conn.execute(
                """
                INSERT INTO bench_crimes
                    (season, week, team_id, bench_player, started_player, position, points_diff, severity)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                season, week, team_id,
                crime["bench_player"], crime["started_player"], crime["position"],
                crime["points_diff"], crime["severity"],
            )
        total_crimes += len(crimes)

    return total_crimes


async def compute_bench_crimes_for_season(pool, season: int) -> int:
    async with pool.acquire() as conn:
        weeks = await conn.fetch(
            "SELECT DISTINCT week FROM rosters WHERE season = $1 ORDER BY week", season
        )
        total = 0
        for w in weeks:
            total += await compute_bench_crimes_for_week(conn, season, w["week"])
    return total


async def compute_bench_crimes_for_single_week(pool, season: int, week: int) -> int:
    """Pool-based single-week entry point for live sync (see
    app/providers/sync.py's run_live_sync)."""
    async with pool.acquire() as conn:
        return await compute_bench_crimes_for_week(conn, season, week)
