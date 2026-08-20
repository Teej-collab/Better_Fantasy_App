"""
Chug rule, ported from Fantasy_Helper's bot/stats_engine/chug_debt.py and
scripts/compute_chug_debts.py: every ACTIVE (non-bench, non-IR) roster
slot that scores 0 or fewer fantasy points earns its owner one required
chug. Bench/IR players never count, regardless of score.

Deliberately scoped to this rule only (chug_debts: season/week/owner ->
chugs_owed), per explicit product decision (Aug 20 2026). The original
bot also had a chug_weekly_status table tracking a carryover_owed and a
deadline/consecutive-missed-weeks rule, but neither was ever actually
implemented — carryover_owed is read in a formula but nothing anywhere
writes it (always 0 in practice), and the deadline columns are never
touched by any code at all. Porting that forward would mean building on
top of logic that was never finished rather than the real, working rule.
"""


def compute_chugs_owed(roster_rows: list[dict]) -> int:
    return sum(
        1
        for row in roster_rows
        if row["lineup_slot"] not in ("BE", "IR")
        and (row["points_scored"] or 0) <= 0
    )


async def compute_chug_debts_for_week(conn, season: int, week: int) -> int:
    team_owners = await conn.fetch(
        "SELECT DISTINCT r.team_id, tbs.owner_id FROM rosters r "
        "JOIN teams_by_season tbs ON r.team_id = tbs.id "
        "WHERE r.season = $1 AND r.week = $2",
        season, week,
    )

    for t in team_owners:
        rows = await conn.fetch(
            "SELECT lineup_slot, points_scored FROM rosters WHERE season = $1 AND week = $2 AND team_id = $3",
            season, week, t["team_id"],
        )
        chugs_owed = compute_chugs_owed([dict(r) for r in rows])

        await conn.execute(
            """
            INSERT INTO chug_debts (season, week, owner_id, chugs_owed)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (season, week, owner_id) DO UPDATE SET chugs_owed = EXCLUDED.chugs_owed
            """,
            season, week, t["owner_id"], chugs_owed,
        )

    return len(team_owners)


async def compute_chug_debts_for_season(pool, season: int) -> int:
    async with pool.acquire() as conn:
        weeks = await conn.fetch(
            "SELECT DISTINCT week FROM rosters WHERE season = $1 ORDER BY week", season
        )
        total = 0
        for w in weeks:
            total += await compute_chug_debts_for_week(conn, season, w["week"])
    return total


async def compute_chug_debts_for_single_week(pool, season: int, week: int) -> int:
    """Pool-based single-week entry point for live sync (see
    app/providers/sync.py's run_live_sync) — recomputes just the one week
    that was just re-synced, not the whole season."""
    async with pool.acquire() as conn:
        return await compute_chug_debts_for_week(conn, season, week)
