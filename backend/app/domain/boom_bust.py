"""
Ported from Fantasy_Helper's bot/stats_engine/boom_bust.py (classification
rule) and scripts/compute_boom_bust.py (the write-side script that sets
rosters.is_boom/is_bust), unchanged — see MIGRATION_MAP.md.

Boom/bust classification. Same asymmetric rule applied to whichever
baseline is available:
  - real ESPN projections exist: baseline = projected points
  - no real projections (historical seasons, or before ESPN publishes
    them): baseline = average score at that position, that week,
    league-wide

boom = actual >= baseline + 20
bust = actual <= baseline - 10

Unlike the original script (which recomputed all of history every run),
compute_boom_bust_for_season is scoped to one season so it can run as a
normal step in the sync pipeline without redoing untouched seasons.
"""
from collections import defaultdict

BOOM_OFFSET = 20.0
BUST_OFFSET = 10.0


def classify_boom_bust(points_scored: float, baseline: float):
    if points_scored is None or baseline is None or baseline <= 0:
        return False, False

    diff = points_scored - baseline
    is_boom = diff >= BOOM_OFFSET
    is_bust = diff <= -BUST_OFFSET
    return is_boom, is_bust


def get_baseline(points_projected: float, position_scores: list[float]):
    if points_projected and points_projected > 0:
        return points_projected

    if not position_scores:
        return None
    return sum(position_scores) / len(position_scores)


async def compute_boom_bust_for_week(conn, season: int, week: int) -> int:
    rows = await conn.fetch(
        """
        SELECT id, position, points_scored, points_projected
        FROM rosters
        WHERE season = $1 AND week = $2 AND lineup_slot NOT IN ('BE', 'IR')
        """,
        season, week,
    )

    by_position = defaultdict(list)
    for r in rows:
        by_position[r["position"]].append(float(r["points_scored"] or 0))

    for r in rows:
        baseline = get_baseline(float(r["points_projected"] or 0), by_position[r["position"]])
        is_boom, is_bust = classify_boom_bust(float(r["points_scored"] or 0), baseline)
        await conn.execute(
            "UPDATE rosters SET is_boom = $1, is_bust = $2 WHERE id = $3",
            is_boom, is_bust, r["id"],
        )

    return len(rows)


async def compute_boom_bust_for_season(pool, season: int) -> int:
    async with pool.acquire() as conn:
        weeks = await conn.fetch(
            "SELECT DISTINCT week FROM rosters WHERE season = $1 ORDER BY week", season
        )
        total = 0
        for w in weeks:
            total += await compute_boom_bust_for_week(conn, season, w["week"])
    return total
