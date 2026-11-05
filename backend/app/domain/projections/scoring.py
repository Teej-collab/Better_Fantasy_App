"""
One projected stat line -> one league's expected points.

Expected points split cleanly in two:
  - per-unit rules (0.5 per catch, 0.04 per passing yard, 6 per TD,
    TE premium…): the rule times the average — exact, since an average
    of points is the points of the average for these;
  - threshold rules (a 100-yard bonus, a D/ST points-allowed tier): the
    rule times the chance of reaching it (distribution.py's probs).

That's the whole expectation for any league's rules, which is what
makes a projection right for every scoring setup. The same derivations
real scoring uses (stat_derivations.derive_stat_line: te_rec from a TE's
catches, the game bonuses) apply here, so a rule means the same thing
in a projection as in a final score.
"""
from app.domain.roster_slots import fantasy_position


def expected_points(line: dict[str, float], probs: dict[str, float], position: str, rules: dict[str, float]) -> float:
    total = 0.0
    for category, value in line.items():
        if not category.startswith("_"):
            total += rules.get(category, 0.0) * value
    if fantasy_position(position) == "TE":
        total += rules.get("te_rec", 0.0) * line.get("rec", 0.0)
    for category, chance in probs.items():
        if not category.startswith("_"):
            total += rules.get(category, 0.0) * chance
    return total


def floor_ceiling(points: float, position: str, floor_ratio, ceiling_ratio, probs: dict) -> tuple[float | None, float | None]:
    if position == "DEF":
        low, high = probs.get("_floor_delta"), probs.get("_ceiling_delta")
        return (
            round(points + low, 2) if low is not None else None,
            round(points + high, 2) if high is not None else None,
        )
    return (
        round(points * float(floor_ratio), 2) if floor_ratio is not None else None,
        round(points * float(ceiling_ratio), 2) if ceiling_ratio is not None else None,
    )
