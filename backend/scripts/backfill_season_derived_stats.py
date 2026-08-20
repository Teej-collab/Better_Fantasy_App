"""
Backfills weekly_team_stats (power_rank, luck_score, chaos_score),
bench_crimes, season_awards, and season_champions for a season whose
matchups/rosters/final_standings already exist but whose *derived*
stats don't (see TODO.md's open question: "who computes
weekly_team_stats/bench_crimes/season_awards/chug_debts going
forward"). Better_Fantasy_App's own sync pipeline only computes
boom_bust (app/providers/sync.py) — everything here still only exists
as Fantasy_Helper's own compute_*.py scripts, so this reuses that
logic directly (imported via sys.path, not copy-pasted) rather than
reimplementing it — the same "port, don't reinvent" rule the rest of
this migration has followed.

This is a stopgap, not the real fix. It depends on a local checkout of
Fantasy_Helper existing as a sibling directory, which won't be true on
every machine or in production. The real fix — porting this logic into
app/domain/ and wiring it into the sync pipeline so this gap can't
recur once the 2026 season starts producing real games — is tracked in
TODO.md, not done here.

Usage (from backend/): python scripts/backfill_season_derived_stats.py 2024
"""
import asyncio
import sys
from decimal import Decimal
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_FANTASY_HELPER_DIR = _BACKEND_DIR.parents[1] / "Fantasy_Helper"

if not _FANTASY_HELPER_DIR.exists():
    raise SystemExit(
        f"Expected Fantasy_Helper checked out as a sibling of Better_Fantasy_App at "
        f"{_FANTASY_HELPER_DIR} — this script reuses its stats_engine/awards_engine logic "
        "directly rather than duplicating it. Clone it there, or port the specific "
        "compute_*.py logic into app/domain/ instead (the real long-term fix)."
    )

sys.path.insert(0, str(_FANTASY_HELPER_DIR))
sys.path.insert(0, str(_BACKEND_DIR))

from app.db import get_pool  # noqa: E402
from bot.awards_engine.determine_season_awards import determine_and_save_season_awards  # noqa: E402
from bot.stats_engine.bench_crime import detect_bench_crimes  # noqa: E402
from bot.stats_engine.chaos import compute_chaos_score  # noqa: E402
from bot.stats_engine.luck import compute_luck_score  # noqa: E402
from bot.stats_engine.power_rank import compute_power_ranks  # noqa: E402


async def backfill_power_ranks(conn, season: int):
    weeks = await conn.fetch(
        "SELECT DISTINCT week FROM matchups WHERE season = $1 AND home_score > 0 ORDER BY week", season
    )
    for w in weeks:
        week = w["week"]
        team_rows = await conn.fetch("SELECT id FROM teams_by_season WHERE season = $1", season)
        team_stats = []
        for t in team_rows:
            team_id = t["id"]
            games = await conn.fetch(
                """
                SELECT
                    CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END AS my_score,
                    CASE WHEN home_team_id = $1 THEN away_score ELSE home_score END AS opp_score
                FROM matchups
                WHERE season = $2 AND week <= $3
                  AND (home_team_id = $1 OR away_team_id = $1) AND home_score > 0
                ORDER BY week
                """,
                team_id, season, week,
            )
            if not games:
                continue
            wins = sum(1 for g in games if g["my_score"] > g["opp_score"])
            win_pct = wins / len(games)
            avg_points = sum(float(g["my_score"]) for g in games) / len(games)
            recent = games[-3:] if len(games) >= 3 else games
            recent_form = sum(float(g["my_score"]) for g in recent) / len(recent)
            team_stats.append(
                {"team_id": team_id, "win_pct": win_pct, "avg_points": avg_points, "recent_form": recent_form}
            )

        if not team_stats:
            continue
        ranks = compute_power_ranks(team_stats)
        for t in team_stats:
            await conn.execute(
                """
                INSERT INTO weekly_team_stats (season, week, team_id, power_rank)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (season, week, team_id) DO UPDATE SET power_rank = EXCLUDED.power_rank
                """,
                season, week, t["team_id"], ranks[t["team_id"]],
            )
    print(f"  power_rank: {len(weeks)} weeks")


async def backfill_luck_scores(conn, season: int):
    weeks = await conn.fetch(
        "SELECT DISTINCT week FROM matchups WHERE season = $1 AND home_score > 0 ORDER BY week", season
    )
    count = 0
    for w in weeks:
        week = w["week"]
        matchups = await conn.fetch("SELECT * FROM matchups WHERE season = $1 AND week = $2", season, week)
        all_scores = []
        for m in matchups:
            all_scores.append(float(m["home_score"]))
            all_scores.append(float(m["away_score"]))
        for m in matchups:
            home_won = m["home_score"] > m["away_score"]
            home_luck = Decimal(str(round(compute_luck_score(float(m["home_score"]), all_scores, home_won), 2)))
            away_luck = Decimal(
                str(round(compute_luck_score(float(m["away_score"]), all_scores, not home_won), 2))
            )
            for team_id, luck in ((m["home_team_id"], home_luck), (m["away_team_id"], away_luck)):
                await conn.execute(
                    """
                    INSERT INTO weekly_team_stats (season, week, team_id, luck_score)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (season, week, team_id) DO UPDATE SET luck_score = EXCLUDED.luck_score
                    """,
                    season, week, team_id, luck,
                )
                count += 1
    print(f"  luck_score: {count} team-weeks")


async def backfill_chaos_scores(conn, season: int):
    combos = await conn.fetch(
        "SELECT DISTINCT week, team_id FROM rosters WHERE season = $1 ORDER BY week", season
    )
    for c in combos:
        week, team_id = c["week"], c["team_id"]
        starters = await conn.fetch(
            """
            SELECT is_boom, is_bust FROM rosters
            WHERE season = $1 AND week = $2 AND team_id = $3 AND lineup_slot NOT IN ('BE', 'IR')
            """,
            season, week, team_id,
        )
        boom_count = sum(1 for s in starters if s["is_boom"])
        bust_count = sum(1 for s in starters if s["is_bust"])
        chaos = Decimal(str(round(compute_chaos_score(boom_count, bust_count, len(starters)), 2)))
        await conn.execute(
            """
            INSERT INTO weekly_team_stats (season, week, team_id, chaos_score)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (season, week, team_id) DO UPDATE SET chaos_score = EXCLUDED.chaos_score
            """,
            season, week, team_id, chaos,
        )
    print(f"  chaos_score: {len(combos)} team-weeks")


async def backfill_bench_crimes(conn, season: int):
    combos = await conn.fetch(
        "SELECT DISTINCT week, team_id FROM rosters WHERE season = $1 ORDER BY week", season
    )
    for c in combos:
        week, team_id = c["week"], c["team_id"]
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
                Decimal(str(crime["points_diff"])), crime["severity"],
            )
    print(f"  bench_crimes: {len(combos)} team-weeks scanned")


async def backfill_season_champion(conn, season: int):
    row = await conn.fetchrow(
        """
        SELECT t.owner_id, t.team_name FROM final_standings fs
        JOIN teams_by_season t ON fs.team_id = t.id
        WHERE fs.season = $1 AND fs.final_rank = 1
        """,
        season,
    )
    if not row:
        print("  season_champions: no final_rank=1 row found, skipped")
        return
    await conn.execute(
        """
        INSERT INTO season_champions (season, owner_id, team_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (season) DO UPDATE SET owner_id = EXCLUDED.owner_id, team_name = EXCLUDED.team_name
        """,
        season, row["owner_id"], row["team_name"],
    )
    print(f"  season_champions: {row['team_name']}")


async def main(season: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        print(f"Backfilling derived stats for season {season}...")
        await backfill_power_ranks(conn, season)
        await backfill_luck_scores(conn, season)
        await backfill_chaos_scores(conn, season)
        await backfill_bench_crimes(conn, season)
        await backfill_season_champion(conn, season)
        winners = await determine_and_save_season_awards(conn, season)
        print(f"  season_awards: {len(winners)} awards determined")
        for award_type, (owner_id, detail, _value) in winners.items():
            name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)
            print(f"    {award_type}: {name} — {detail}")
    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/backfill_season_derived_stats.py <season>")
    asyncio.run(main(int(sys.argv[1])))
