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


from app.config import DEFAULT_LEAGUE_ID
from app.domain.roster_source import uses_in_app_rosters
from app.providers.nfl_scoreboard import get_week_scoreboard, is_week_final


def compute_chugs_owed(roster_rows: list[dict]) -> int:
    return sum(
        1
        for row in roster_rows
        if row["lineup_slot"] not in ("BE", "IR")
        and (row["points_scored"] or 0) <= 0
    )


async def compute_chug_debts_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    # 2026-09-10 fix, real incident: this is called every live-sync tick
    # (every ~60s) while a game is live, and compute_chugs_owed treats a
    # NULL points_scored (a rostered starter whose real game just hasn't
    # happened yet this week — most players on a Wed-kickoff week like
    # this one) the same as a real 0-point bust. That's the correct rule
    # once the week is actually over (an inactive/bye starter *should*
    # owe a chug), but mid-week it was charging chugs for players who
    # simply hadn't played yet. Chugs are only ever really "owed" once
    # every game in the week has been played — see is_week_final.
    games = await get_week_scoreboard(week=week, year=season)
    if not is_week_final(games):
        return 0

    in_app = await uses_in_app_rosters(conn, season)
    if in_app:
        team_owners = await conn.fetch(
            "SELECT DISTINCT rh.team_id, tbs.owner_id FROM roster_history rh "
            "JOIN teams_by_season tbs ON rh.team_id = tbs.id "
            "WHERE rh.season = $1 AND rh.week = $2 AND tbs.league_id = $3",
            season, week, league_id,
        )
    else:
        team_owners = await conn.fetch(
            "SELECT DISTINCT r.team_id, tbs.owner_id FROM rosters r "
            "JOIN teams_by_season tbs ON r.team_id = tbs.id "
            "WHERE r.season = $1 AND r.week = $2 AND r.league_id = $3",
            season, week, league_id,
        )

    for t in team_owners:
        if in_app:
            rows = await conn.fetch(
                """
                SELECT rh.lineup_slot, pws.fantasy_points AS points_scored
                FROM roster_history rh
                LEFT JOIN player_week_stats pws
                    ON pws.season = rh.season AND pws.week = rh.week AND pws.sleeper_player_id = rh.sleeper_player_id
                    AND pws.league_id = $4
                WHERE rh.season = $1 AND rh.week = $2 AND rh.team_id = $3
                """,
                season, week, t["team_id"], league_id,
            )
        else:
            rows = await conn.fetch(
                "SELECT lineup_slot, points_scored FROM rosters "
                "WHERE season = $1 AND week = $2 AND team_id = $3 AND league_id = $4",
                season, week, t["team_id"], league_id,
            )
        chugs_owed = compute_chugs_owed([dict(r) for r in rows])

        await conn.execute(
            """
            INSERT INTO chug_debts (season, week, owner_id, chugs_owed, league_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (season, week, owner_id, league_id) DO UPDATE SET chugs_owed = EXCLUDED.chugs_owed
            """,
            season, week, t["owner_id"], chugs_owed, league_id,
        )

    return len(team_owners)


async def compute_chug_debts_for_season(pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
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
            total += await compute_chug_debts_for_week(conn, season, w["week"], league_id)
    return total


async def compute_chug_debts_for_single_week(pool, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Pool-based single-week entry point for live sync (see
    app/providers/sync.py's run_live_sync) — recomputes just the one week
    that was just re-synced, not the whole season."""
    async with pool.acquire() as conn:
        return await compute_chug_debts_for_week(conn, season, week, league_id)
