"""
Raw per-player NFL stats for the scoring engine (Phase D) — ESPN's
public, unauthenticated boxscore endpoint
(site.api.espn.com/apis/site/v2/sports/football/nfl/summary), verified
in SCORING_ENGINE_SOURCE.md to expose full per-player stat lines with
real ESPN player ids. Same host/no-credentials shape as
app/providers/nfl_scoreboard.py and Gamecast's ESPN provider — this is
a read of ESPN's PUBLIC data, unrelated to the private fantasy API this
app moved off of for writes.

Covers only the verified, well-supported individual-player bulk stat
categories (passing/rushing/receiving/fumbles-lost/return-TDs/extra
points) — see SCORING_ENGINE_SOURCE.md's "Known gap" section for what's
deliberately NOT here yet (2pt conversions, blocked kicks, safeties,
field-goal scoring by distance, and team-level D/ST aggregation, which
needs its own design pass and isn't built here).
"""
import httpx

SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"

# (ESPN stat category name, ESPN's raw key within it) -> our
# league_scoring_rules stat_category name. Deliberately explicit and
# small rather than "map everything" — an unmapped raw stat simply
# never reaches a stat_line, which is safer than silently guessing a
# name for something not confirmed against this league's real rules.
_STAT_MAP: dict[tuple[str, str], str] = {
    ("passing", "passingYards"): "pass_yd",
    ("passing", "passingTouchdowns"): "pass_td",
    ("passing", "interceptions"): "pass_int",
    ("rushing", "rushingYards"): "rush_yd",
    ("rushing", "rushingTouchdowns"): "rush_td",
    ("receiving", "receivingYards"): "rec_yd",
    ("receiving", "receptions"): "rec",
    ("receiving", "receivingTouchdowns"): "rec_td",
    ("fumbles", "fumblesLost"): "fum_lost",
    ("kickReturns", "kickReturnTouchdowns"): "ret_td",
    ("puntReturns", "puntReturnTouchdowns"): "ret_td",
    ("interceptions", "interceptionTouchdowns"): "ret_td",
}

# "made/attempted" combined strings (e.g. "3/4") — only extra points
# are scored in v1; field goals need distance-bucketed data this
# endpoint's game-total-only kicking category doesn't provide (see
# SCORING_ENGINE_SOURCE.md), so FG makes/misses are deliberately not
# mapped here at all rather than scored wrong.
_MADE_ATTEMPTED_MAP: dict[tuple[str, str], str] = {
    ("kicking", "extraPointsMade/extraPointAttempts"): "xp_made",
}


def _parse_made(value: str) -> float:
    made = value.split("/")[0]
    try:
        return float(made)
    except ValueError:
        return 0.0


async def get_game_player_stats(event_id: str) -> list[dict]:
    """One entry per player who recorded a mapped stat in this game:
    {"espn_player_id": int, "player_name": str, "pro_team": str,
    "stat_line": {category: count}}. A player appearing in multiple
    stat categories (e.g. a QB who also ran for a TD) gets one merged
    entry, not duplicates."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(SUMMARY_URL, params={"event": event_id})
        response.raise_for_status()
        data = response.json()

    players_by_id: dict[int, dict] = {}

    for team_entry in data.get("boxscore", {}).get("players", []):
        team_abbr = team_entry.get("team", {}).get("abbreviation")
        for category in team_entry.get("statistics", []):
            category_name = category.get("name")
            keys = category.get("keys", [])
            for athlete_entry in category.get("athletes", []):
                athlete = athlete_entry.get("athlete", {})
                espn_player_id = athlete.get("id")
                if espn_player_id is None:
                    continue
                espn_player_id = int(espn_player_id)
                stats = athlete_entry.get("stats", [])

                entry = players_by_id.setdefault(
                    espn_player_id,
                    {
                        "espn_player_id": espn_player_id,
                        "player_name": athlete.get("displayName"),
                        "pro_team": team_abbr,
                        "stat_line": {},
                    },
                )

                for raw_key, raw_value in zip(keys, stats):
                    mapped = _STAT_MAP.get((category_name, raw_key))
                    if mapped is not None:
                        try:
                            entry["stat_line"][mapped] = entry["stat_line"].get(mapped, 0) + float(raw_value)
                        except ValueError:
                            pass
                        continue
                    made_key = _MADE_ATTEMPTED_MAP.get((category_name, raw_key))
                    if made_key is not None:
                        entry["stat_line"][made_key] = entry["stat_line"].get(made_key, 0) + _parse_made(raw_value)

    return list(players_by_id.values())
