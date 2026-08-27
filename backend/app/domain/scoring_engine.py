"""
The fantasy-points formula itself (Phase D of the ESPN-independence
pivot — see TODO.md, SCORING_ENGINE_SOURCE.md). Pure, no DB, no
network — takes a raw stat line and this league's real scoring rules
and returns a point total. Everything about *where* the raw stats or
rules come from lives elsewhere (app/providers/nfl_stats/,
app/queries/scoring.py) so this stays trivially testable.

D/ST's "starts at 10" behavior (this league's real rule) is NOT a
separate flat bonus applied here — it's a natural consequence of this
league's real league_scoring_rules values: pts_allow_0 = 5 and
yds_allow_lt100 = 5 (the "opponent has scored/gained nothing yet"
tiers), which already sum to 10 on their own. A team D/ST's stat_line
(app/providers/nfl_stats/espn_public.py's parse_team_dst_stats) always
carries exactly one points-allowed tier and one yards-allowed tier —
whichever match the opponent's CURRENT cumulative score/yards, live-
recomputed every poll — so compute_player_points needs no D/ST-specific
baseline parameter at all: a team D/ST is scored with the exact same
formula as any individual player. An earlier version of this function
added a separate flat +10 on top of these same tiers, which double-
counted the starting state (10 + 5 + 5 = 20 at kickoff) — caught and
removed once the real tier values were checked against the real
scoring config directly.
"""


def compute_player_points(stat_line: dict[str, float], rules: dict[str, float]) -> float:
    """stat_line: {stat_category: raw_count}, e.g. {"pass_yd": 250,
    "pass_td": 2, "pass_int": 1}. rules: {stat_category:
    points_per_unit}, e.g. from league_scoring_rules. A stat_category
    present in stat_line but missing from rules contributes nothing
    (not an error — rules can legitimately not cover every category a
    raw feed happens to report). Rounded to 2 decimal places, matching
    how fantasy scores are conventionally displayed."""
    total = sum(count * rules.get(category, 0) for category, count in stat_line.items())
    return round(total, 2)


def rules_dict_from_rows(rows) -> dict[str, float]:
    """Converts league_scoring_rules DB rows (asyncpg Records with
    stat_category/points_per_unit) into the plain dict compute_player_
    points expects. points_per_unit comes back as a Decimal from
    Postgres NUMERIC — cast to float so downstream arithmetic (and
    JSON serialization of raw_stats/results) doesn't have to deal with
    Decimal at all."""
    return {row["stat_category"]: float(row["points_per_unit"]) for row in rows}
