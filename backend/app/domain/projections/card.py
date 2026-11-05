"""
The player card's projection block (2026-11-05): this week's projection
in the league's own scoring with its floor and ceiling, what each source
says, the stat line behind it, the inputs our model used, the odds of
the bonuses this league pays, and the rest of the season week by week.
"""
import json

from app.domain.projections.accuracy import DEFAULT_WEIGHTS

# Stat line keys worth showing, in display order.
_SHOWN = (
    "pass_cmp", "_pass_att", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td",
    "_tgt", "rec", "rec_yd", "rec_td", "fg_made_0_39", "fg_made_40_49", "fg_made_50_plus", "xp_made",
    "def_sack", "def_int", "def_fum_rec", "_pts_allow", "idp_tackle", "idp_sack", "idp_int", "idp_pass_def",
)


async def player_projection(conn, league_id: int, season: int, sleeper_player_id: str, week: int | None) -> dict | None:
    if week is None:
        return None
    rows = await conn.fetch(
        """
        SELECT week, projected_points, floor_points, ceiling_points, by_source
        FROM league_player_projections
        WHERE league_id = $1 AND season = $2 AND sleeper_player_id = $3 AND week >= $4
        ORDER BY week
        """,
        league_id, season, sleeper_player_id, week,
    )
    if not rows or rows[0]["week"] != week:
        return None
    now = rows[0]
    lines = {
        r["source"]: (json.loads(r["line"]), json.loads(r["probs"]))
        for r in await conn.fetch(
            "SELECT source, line, probs FROM projection_lines WHERE season = $1 AND week = $2 AND sleeper_player_id = $3",
            season, week, sleeper_player_id,
        )
    }
    # The stat line behind the number: the sources' lines blended with
    # the same default weights.
    total = sum(DEFAULT_WEIGHTS[s] for s in lines)
    stat_line = {}
    for key in _SHOWN:
        values = [(DEFAULT_WEIGHTS[s], line.get(key)) for s, (line, _) in lines.items() if line.get(key) is not None]
        if values and total:
            stat_line[key.lstrip("_")] = round(sum(w * v for w, v in values) / sum(w for w, _ in values), 1)
    rules = {
        r["stat_category"]
        for r in await conn.fetch(
            "SELECT stat_category FROM league_scoring_rules WHERE league_id = $1 AND season = $2 AND points_per_unit <> 0",
            league_id, season,
        )
    }
    model_line, model_probs = lines.get("model", ({}, {}))
    bonus_odds = {k: v for k, v in model_probs.items() if k.startswith("bonus_") and k in rules and v >= 0.01}
    return {
        "week": week,
        "points": float(now["projected_points"]),
        "floor": float(now["floor_points"]) if now["floor_points"] is not None else None,
        "ceiling": float(now["ceiling_points"]) if now["ceiling_points"] is not None else None,
        "by_source": json.loads(now["by_source"]),
        "stat_line": stat_line,
        "why": model_line.get("_why"),
        "bonus_odds": bonus_odds,
        "rest_of_season": [{"week": r["week"], "points": float(r["projected_points"])} for r in rows[1:]],
    }
