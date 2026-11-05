"""
Grading (2026-11-05): once a week is final, how far each source's
projections missed the real results, by position, and the blend
weights that follow.

Graded under one fixed half-PPR scoring (distribution.CANONICAL_RULES)
so weeks compare to each other; the ranking of sources barely moves
with the scoring. Only players who actually played and whom a source
called worth a look (4+ points) count — a projection for a deep backup
who never saw the field says nothing about anyone's lineup.

Weights: each source's weight per position is 1 / MAE², from the
season's graded weeks, normalized. Until three weeks are graded the
blend leans on the established sites (DEFAULT_WEIGHTS). The 2026 weeks
3–8 backtest: half-PPR MAE ours 4.75, Sleeper 4.71, ESPN 4.81, the
equal three-way blend 4.69 — better than any one source.
"""
import json

from app.domain.projections import stat_lines
from app.domain.projections.distribution import CANONICAL_RULES
from app.domain.projections.scoring import expected_points
from app.domain.scoring_engine import compute_player_points
from app.domain.stat_derivations import derive_stat_line
from app.providers.nfl_stats.espn_public import _POINTS_ALLOWED_TIERS, _YARDS_ALLOWED_TIERS, _tier_category

SOURCES = ("model", "sleeper", "espn")
DEFAULT_WEIGHTS = {"model": 0.25, "sleeper": 0.375, "espn": 0.375}
MIN_GRADED_WEEKS = 3
_RELEVANT = 4.0


def actual_points(stats: dict, position: str) -> float:
    """A real Sleeper stat line, scored the canonical way."""
    line = stat_lines.from_sleeper(stats, position)
    if position == "DEF":
        points, yards = line.pop("_pts_allow", None), line.pop("_yds_allow", None)
        if points is not None:
            line[_tier_category(int(points), _POINTS_ALLOWED_TIERS)] = 1
        if yards is not None:
            line[_tier_category(int(yards), _YARDS_ALLOWED_TIERS)] = 1
        return compute_player_points(line, CANONICAL_RULES)
    line = {k: v for k, v in line.items() if not k.startswith("_")}
    return compute_player_points(derive_stat_line(line, position), CANONICAL_RULES)


def _rank_corr(a: list[float], b: list[float]) -> float | None:
    n = len(a)
    if n < 3:
        return None

    def ranks(x):
        order = sorted(range(n), key=lambda i: x[i])
        r = [0] * n
        for k, i in enumerate(order):
            r[i] = k
        return r

    ra, rb = ranks(a), ranks(b)
    return 1 - 6 * sum((x - y) ** 2 for x, y in zip(ra, rb)) / (n * (n * n - 1))


async def grade_week(conn, season: int, week: int) -> int:
    """Grades every source for a final week. Returns rows written."""
    actual = {
        r["sleeper_player_id"]: r
        for r in await conn.fetch(
            "SELECT sleeper_player_id, position, stats FROM nfl_player_weeks WHERE season = $1 AND week = $2",
            season, week,
        )
    }
    projections = await conn.fetch(
        "SELECT sleeper_player_id, source, position, line, probs FROM projection_lines WHERE season = $1 AND week = $2",
        season, week,
    )
    pairs: dict[tuple[str, str], list[tuple[float, float]]] = {}
    for p in projections:
        row = actual.get(p["sleeper_player_id"])
        if row is None:
            continue
        stats = json.loads(row["stats"])
        if p["position"] != "DEF" and not stats.get("gp"):
            continue
        projected = expected_points(json.loads(p["line"]), json.loads(p["probs"]), p["position"], CANONICAL_RULES)
        if projected < _RELEVANT:
            continue
        pairs.setdefault((p["source"], p["position"]), []).append((projected, actual_points(stats, p["position"])))
    written = 0
    for (source, position), values in pairs.items():
        n = len(values)
        mae = sum(abs(p - a) for p, a in values) / n
        bias = sum(p - a for p, a in values) / n
        corr = _rank_corr([p for p, _ in values], [a for _, a in values])
        await conn.execute(
            """
            INSERT INTO projection_accuracy (season, week, source, position, players, mae, bias, rank_corr)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (season, week, source, position) DO UPDATE SET
                players = EXCLUDED.players, mae = EXCLUDED.mae, bias = EXCLUDED.bias,
                rank_corr = EXCLUDED.rank_corr, computed_at = now()
            """,
            season, week, source, position, n, round(mae, 3), round(bias, 3),
            round(corr, 3) if corr is not None else None,
        )
        written += 1
    return written


async def blend_weights(conn, season: int) -> dict[str, dict[str, float]]:
    """{position: {source: weight}}; DEFAULT_WEIGHTS where the season
    hasn't graded enough weeks for that position."""
    rows = await conn.fetch(
        """
        SELECT position, source, SUM(mae * players) / NULLIF(SUM(players), 0) AS mae, COUNT(DISTINCT week) AS weeks
        FROM projection_accuracy WHERE season = $1
        GROUP BY position, source
        """,
        season,
    )
    by_position: dict[str, dict[str, float]] = {}
    for r in rows:
        if r["weeks"] >= MIN_GRADED_WEEKS and r["mae"]:
            by_position.setdefault(r["position"], {})[r["source"]] = 1 / float(r["mae"]) ** 2
    weights = {}
    for position in ("QB", "RB", "WR", "TE", "K", "DEF"):
        raw = by_position.get(position, {})
        if set(raw) != set(SOURCES):
            weights[position] = dict(DEFAULT_WEIGHTS)
            continue
        total = sum(raw.values())
        weights[position] = {s: raw[s] / total for s in SOURCES}
    return weights


def blend(points_by_source: dict[str, float], weights: dict[str, float]) -> float:
    """Weighted average over the sources this player has; a missing
    source's weight goes to the others."""
    present = {s: w for s, w in weights.items() if s in points_by_source}
    total = sum(present.values())
    if not total:
        return 0.0
    return sum(points_by_source[s] * w for s, w in present.items()) / total
