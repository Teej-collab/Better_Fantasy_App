"""
Weeks 1-6 of the demo season: made-up stat lines for every rostered
player (and the best free agents), scored by the league's real scoring
rules, then the same per-week steps the real sync runs. Throwaway
database only.

    DATABASE_URL=postgresql://postgres@127.0.0.1:55432/showreel \\
      python simulate_weeks.py           # run from the backend venv
"""
import asyncio
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "backend"))

from app.db import get_pool  # noqa: E402
from app.domain.boom_bust import compute_boom_bust_for_single_week  # noqa: E402
from app.domain.bench_crimes import compute_bench_crimes_for_single_week  # noqa: E402
from app.domain.matchup_scoring import compute_matchup_scores_for_week  # noqa: E402
from app.domain.scoring_engine import compute_player_points, rules_dict_from_rows  # noqa: E402
from app.domain.weekly_team_stats import compute_weekly_team_stats_for_single_week, lock_power_ranks_for_week  # noqa: E402
from app.providers.sync import update_league_state  # noqa: E402

SEASON = 2026
LEAGUE = int(json.loads(Path(__file__).with_name("demo_accounts.json").read_text())["league_id"])
WEEKS = range(1, 7)
# Marcus (team 1, the viewer) runs a little hot, so the reel opens on a
# contender.
TEAM_BIAS = {1: 1.10}
POS_MEAN = {"QB": 17.0, "RB": 10.0, "WR": 10.0, "TE": 7.0, "K": 8.0, "DEF": 7.0}


def pois(rng: random.Random, lam: float) -> int:
    # Knuth; fine for these small rates.
    l, k, p = pow(2.718281828, -lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def stat_line(rng: random.Random, pos: str, q: float) -> dict:
    """A plausible box-score line for a player of quality q (1.0 = an
    average starter at the position)."""
    g = lambda mu, sd: max(0.0, rng.gauss(mu * q, sd))  # noqa: E731
    if pos == "QB":
        return {"pass_yd": round(g(235, 60)), "pass_td": pois(rng, 1.6 * q), "pass_int": pois(rng, 0.7),
                "rush_yd": round(g(14, 12)), "rush_td": pois(rng, 0.12 * q)}
    if pos == "RB":
        return {"rush_yd": round(g(62, 30)), "rush_td": pois(rng, 0.45 * q),
                "rec": pois(rng, 2.6 * q), "rec_yd": round(g(18, 14)), "rec_td": pois(rng, 0.08 * q)}
    if pos in ("WR", "TE"):
        scale = 1.0 if pos == "WR" else 0.7
        return {"rec": pois(rng, 4.8 * q * scale), "rec_yd": round(g(62 * scale, 30)), "rec_td": pois(rng, 0.42 * q * scale)}
    if pos == "K":
        made = [rng.choice((24, 31, 38, 44, 49, 53)) for _ in range(pois(rng, 1.7 * q))]
        return {"fg_yds": sum(made), "fgm": len(made), "xp_made": pois(rng, 2.4)}
    allowed = max(0, round(rng.gauss(21 / q, 8)))
    bucket = ("pts_allow_0" if allowed == 0 else "pts_allow_1_6" if allowed <= 6 else "pts_allow_7_13" if allowed <= 13
              else "pts_allow_14_17" if allowed <= 17 else "pts_allow_18_27" if allowed <= 27 else "pts_allow_28_34" if allowed <= 34
              else "pts_allow_35_45" if allowed <= 45 else "pts_allow_46_plus")
    return {"def_sack": pois(rng, 2.4 * q), "def_int": pois(rng, 0.8 * q), "def_fum_rec": pois(rng, 0.5), bucket: 1}


async def main() -> None:
    pool = await get_pool()
    rng = random.Random(2026)
    async with pool.acquire() as conn:
        rules = rules_dict_from_rows(await conn.fetch(
            "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE season = $1 AND league_id = $2", SEASON, LEAGUE,
        ))
        players = await conn.fetch(
            """
            SELECT p.sleeper_player_id, p.position, COALESCE(p.projected_avg_points, 0) AS proj, c.team_id
            FROM players p LEFT JOIN current_rosters c ON c.sleeper_player_id = p.sleeper_player_id AND c.season = $1
            WHERE p.position IN ('QB','RB','WR','TE','K','DEF') AND p.pro_team IS NOT NULL
              AND (c.team_id IS NOT NULL OR p.search_rank <= 260)
            """,
            SEASON,
        )
    for week in WEEKS:
        await update_league_state(pool, SEASON, week, advance=True)
        rows = []
        for p in players:
            q = min(1.8, max(0.4, float(p["proj"]) / POS_MEAN[p["position"]] if float(p["proj"]) else 0.6))
            q *= TEAM_BIAS.get(p["team_id"], 1.0)
            line = stat_line(rng, p["position"], q)
            rows.append((SEASON, week, p["sleeper_player_id"], json.dumps(line), compute_player_points(line, rules), LEAGUE))
        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, computed_at, league_id)
                VALUES ($1, $2, $3, $4, $5, now(), $6)
                ON CONFLICT (season, week, sleeper_player_id, league_id) DO UPDATE
                SET raw_stats = EXCLUDED.raw_stats, fantasy_points = EXCLUDED.fantasy_points
                """,
                rows,
            )
            await compute_matchup_scores_for_week(conn, SEASON, week, LEAGUE)
        for step in (compute_boom_bust_for_single_week, compute_weekly_team_stats_for_single_week, compute_bench_crimes_for_single_week):
            await step(pool, SEASON, week, LEAGUE)
        async with pool.acquire() as conn:
            await lock_power_ranks_for_week(conn, SEASON, week, LEAGUE)
        print("week", week, "done")
    await update_league_state(pool, SEASON, 7, advance=True)


asyncio.run(main())
