"""
Raw NFL stats for the scoring engine (Phase D) — ESPN's public,
unauthenticated boxscore endpoint
(site.api.espn.com/apis/site/v2/sports/football/nfl/summary), verified
in SCORING_ENGINE_SOURCE.md to expose full per-player stat lines with
real ESPN player ids, team-level offensive totals, and final scores.
Same host/no-credentials shape as app/providers/nfl_scoreboard.py and
Gamecast's ESPN provider — this is a read of ESPN's PUBLIC data,
unrelated to the private fantasy API this app moved off of for writes.

Two things come out of one game's summary: individual-player stat
lines (get_game_player_stats) and team D/ST stat lines
(get_game_team_dst_stats) — get_game_stats fetches once and returns
both, since weekly_stats.py needs both per game and a second network
round-trip would be wasteful.

Covers only the verified, well-supported stat categories — see
SCORING_ENGINE_SOURCE.md's "Known gap" section for what's deliberately
NOT here (2pt conversions, blocked kicks, safeties, field-goal scoring
by distance — none of these are in ESPN's boxscore stat tables at all,
only in play-by-play, which isn't parsed here).
"""
import httpx

SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"

# (ESPN stat category name, ESPN's raw key within it) -> our
# league_scoring_rules stat_category name. Deliberately explicit and
# small rather than "map everything" — an unmapped raw stat simply
# never reaches a stat_line, which is safer than silently guessing a
# name for something not confirmed against this league's real rules.
_INDIVIDUAL_STAT_MAP: dict[tuple[str, str], str] = {
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

# Team D/ST aggregate categories — summed across every player on a
# team's own boxscore.players[] entry. Each of these counts toward
# league_scoring_rules' matching category directly (no bucketing).
#
# def_fum_rec caveat: "fumblesRecovered" doesn't distinguish recovering
# the OPPONENT's fumble (a real defensive play) from recovering your
# OWN team's fumble (e.g. a QB falling on his own bad snap) — this
# sums all of it, a known, documented small overcounting risk rather
# than an unverified guess at how to tell them apart from this data.
_TEAM_DST_STAT_MAP: dict[tuple[str, str], str] = {
    ("defensive", "sacks"): "def_sack",
    ("defensive", "defensiveTouchdowns"): "def_return_td",
    ("interceptions", "interceptions"): "def_int",
    ("interceptions", "interceptionTouchdowns"): "def_return_td",
    ("fumbles", "fumblesRecovered"): "def_fum_rec",
    # A kick/punt return TD scores for BOTH the individual returner
    # (see _INDIVIDUAL_STAT_MAP's ret_td) AND the team D/ST unit — this
    # league's own scoring screenshots list "Kickoff/Punt Return TD"
    # under both the Team Defense/Special Teams AND Miscellaneous
    # sections at the same point value, confirming the double-credit
    # is intentional, not a mapping bug.
    ("kickReturns", "kickReturnTouchdowns"): "def_return_td",
    ("puntReturns", "puntReturnTouchdowns"): "def_return_td",
}

_POINTS_ALLOWED_TIERS: list[tuple[int | None, str]] = [
    (0, "pts_allow_0"), (6, "pts_allow_1_6"), (13, "pts_allow_7_13"), (17, "pts_allow_14_17"),
    (27, "pts_allow_18_27"), (34, "pts_allow_28_34"), (45, "pts_allow_35_45"), (None, "pts_allow_46_plus"),
]
_YARDS_ALLOWED_TIERS: list[tuple[int | None, str]] = [
    (99, "yds_allow_lt100"), (199, "yds_allow_100_199"), (299, "yds_allow_200_299"), (349, "yds_allow_300_349"),
    (399, "yds_allow_350_399"), (449, "yds_allow_400_449"), (499, "yds_allow_450_499"), (549, "yds_allow_500_549"),
    (None, "yds_allow_550_plus"),
]


def _tier_category(value: int, tiers: list[tuple[int | None, str]]) -> str:
    for ceiling, category in tiers:
        if ceiling is None or value <= ceiling:
            return category
    return tiers[-1][1]  # unreachable given the None sentinel above, kept defensive


def _parse_made(value: str) -> float:
    try:
        return float(value.split("/")[0])
    except (ValueError, IndexError):
        return 0.0


async def _fetch_summary(event_id: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(SUMMARY_URL, params={"event": event_id})
        response.raise_for_status()
        return response.json()


def parse_individual_player_stats(data: dict) -> list[dict]:
    """One entry per player who recorded a mapped stat in this game:
    {"espn_player_id": int, "player_name": str, "pro_team": str,
    "stat_line": {category: count}}. A player appearing in multiple
    stat categories (e.g. a QB who also ran for a TD) gets one merged
    entry, not duplicates."""
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
                    mapped = _INDIVIDUAL_STAT_MAP.get((category_name, raw_key))
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


def parse_team_dst_stats(data: dict) -> dict[str, dict]:
    """One entry per team, keyed by ESPN's team abbreviation (matching
    Sleeper's own DEF sleeper_player_id convention — see
    app/providers/sleeper/ingest.py): {"KC": {"pts_allow_7_13": 1,
    "yds_allow_200_299": 1, "def_sack": 3, ...}}. Missing/malformed
    sections (score or yardage not found for a team) skip that half of
    the computation gracefully rather than raising — a partial game
    read shouldn't crash the whole week's compute."""
    scores: dict[str, int] = {}
    for competitor in data.get("header", {}).get("competitions", [{}])[0].get("competitors", []):
        abbr = competitor.get("team", {}).get("abbreviation")
        score = competitor.get("score")
        if abbr and score is not None:
            try:
                scores[abbr] = int(score)
            except ValueError:
                pass

    yards: dict[str, int] = {}
    for team_entry in data.get("boxscore", {}).get("teams", []):
        abbr = team_entry.get("team", {}).get("abbreviation")
        total_yards_stat = next(
            (s for s in team_entry.get("statistics", []) if s.get("name") == "totalYards"), None
        )
        if abbr and total_yards_stat:
            try:
                yards[abbr] = int(total_yards_stat.get("displayValue", ""))
            except ValueError:
                pass

    team_abbrs = set(scores) | set(yards)
    stat_lines: dict[str, dict] = {abbr: {} for abbr in team_abbrs}

    for abbr in team_abbrs:
        opponents = [a for a in team_abbrs if a != abbr]
        if len(opponents) != 1:
            continue  # not a normal 2-team game read — skip tiering rather than guess
        opponent = opponents[0]
        if opponent in scores:
            stat_lines[abbr][_tier_category(scores[opponent], _POINTS_ALLOWED_TIERS)] = 1
        if opponent in yards:
            stat_lines[abbr][_tier_category(yards[opponent], _YARDS_ALLOWED_TIERS)] = 1

    for team_entry in data.get("boxscore", {}).get("players", []):
        abbr = team_entry.get("team", {}).get("abbreviation")
        if abbr not in stat_lines:
            stat_lines.setdefault(abbr, {})
        for category in team_entry.get("statistics", []):
            category_name = category.get("name")
            keys = category.get("keys", [])
            for athlete_entry in category.get("athletes", []):
                for raw_key, raw_value in zip(keys, athlete_entry.get("stats", [])):
                    mapped = _TEAM_DST_STAT_MAP.get((category_name, raw_key))
                    if mapped is None:
                        continue
                    try:
                        stat_lines[abbr][mapped] = stat_lines[abbr].get(mapped, 0) + float(raw_value)
                    except ValueError:
                        pass

    return stat_lines


async def get_game_player_stats(event_id: str) -> list[dict]:
    return parse_individual_player_stats(await _fetch_summary(event_id))


async def get_game_team_dst_stats(event_id: str) -> dict[str, dict]:
    return parse_team_dst_stats(await _fetch_summary(event_id))


async def get_game_stats(event_id: str) -> dict:
    """Both parses from a single fetch — use this (not the two
    functions above) when you need both, e.g. weekly_stats.py's
    per-event loop."""
    data = await _fetch_summary(event_id)
    return {"players": parse_individual_player_stats(data), "team_dst": parse_team_dst_stats(data)}
