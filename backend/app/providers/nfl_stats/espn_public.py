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
NOT here (2pt conversions, blocked kicks, safeties — none of these are
in ESPN's boxscore stat tables at all, only in play-by-play, which
isn't parsed here). Field-goal-by-yardage (fg_yds) WAS in that gap
list and no longer is (2026-09) — see _parse_fg_yards_by_player below
for how it's actually captured, from a genuinely different part of the
same summary response than the rest of this file reads.
"""
import re

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
    # "defensive" already covers sacks (via _TEAM_DST_STAT_MAP below) —
    # totalTackles is the same category, same per-athlete reliability,
    # just never read before now (2026-09, the owner's own request).
    # Genuinely not restricted to defensive positions in ESPN's own
    # data: a QB who makes a real tackle (e.g. after his own
    # interception gets returned) shows up in this same "defensive"
    # category for that game, exactly like anyone else who recorded
    # one — which is the actual answer to "can we track QB tackles":
    # yes, because this was never position-scoped to begin with.
    ("defensive", "totalTackles"): "def_tackle",
}

_FG_MADE_TEXT_RE = re.compile(r"(\d+) Yd Field Goal$")


def _parse_fg_yards_by_player(data: dict) -> dict[int, float]:
    """{espn_player_id: total yards of MADE field goals this game} —
    real per-kick distances aren't in the boxscore `statistics` tables
    at all (see this module's own docstring on the gap this used to
    be); they're in the separate top-level `scoringPlays` array, e.g.
    {"text": "Brandon Aubrey 41 Yd Field Goal", "type": {"abbreviation":
    "FG"}, "team": {"abbreviation": "DAL"}} — a kicker's NAME and team,
    never an athlete id.

    Real player-ID attribution comes from cross-referencing the
    boxscore's own `kicking` category instead, which — unlike
    scoringPlays — DOES carry a real espn_player_id per athlete, just
    without per-kick distance (only game totals). A team with exactly
    one athlete in that category this game gets every one of that
    team's made-FG scoringPlays attributed to them; a team with more
    than one (a backup/emergency kicker mid-game — rare, unverified
    against real data) is skipped entirely rather than guessed at,
    same "safer to undercount than guess" rule the rest of this file
    already follows for def_fum_rec's own known imprecision.

    Misses aren't captured here — makes are the only field goals that
    ever appear in `scoringPlays` (a miss doesn't score), and a miss's
    distance isn't in the boxscore's per-athlete kicking totals either
    (just makes/attempts as a ratio) — a real, separate, currently
    unaddressed gap, not silently guessed at."""
    kicker_by_team: dict[str, list[int]] = {}
    for team_entry in data.get("boxscore", {}).get("players", []):
        team_abbr = team_entry.get("team", {}).get("abbreviation")
        if not team_abbr:
            continue
        for category in team_entry.get("statistics", []):
            if category.get("name") != "kicking":
                continue
            for athlete_entry in category.get("athletes", []):
                espn_player_id = athlete_entry.get("athlete", {}).get("id")
                if espn_player_id is not None:
                    kicker_by_team.setdefault(team_abbr, []).append(int(espn_player_id))

    yards_by_player: dict[int, float] = {}
    for play in data.get("scoringPlays", []):
        if play.get("type", {}).get("abbreviation") != "FG":
            continue
        match = _FG_MADE_TEXT_RE.search(play.get("text", ""))
        if not match:
            continue
        team_abbr = play.get("team", {}).get("abbreviation")
        kickers = kicker_by_team.get(team_abbr, [])
        if len(kickers) != 1:
            continue  # ambiguous (0 or 2+ kickers credited) — skip rather than guess
        yards_by_player[kickers[0]] = yards_by_player.get(kickers[0], 0) + int(match.group(1))

    return yards_by_player

# "made/attempted" combined strings (e.g. "3/4").
_MADE_ATTEMPTED_MAP: dict[tuple[str, str], str] = {
    ("kicking", "extraPointsMade/extraPointAttempts"): "xp_made",
}

# fg_miss_total (2026-09, restored): a missed field goal's own DISTANCE
# isn't available anywhere in this response — a miss doesn't appear in
# scoringPlays at all (nothing scored), and isn't broken out from the
# makes/attempts ratio either — so a per-distance miss penalty (this
# league's old fg_miss_0_39/40_49/50_plus buckets) genuinely still
# can't be computed and stays out. A flat per-miss count is different:
# it's just attempts minus makes, both already sitting in this exact
# same "made/attempted" string this file already parses for xp_made.
_MISSED_MAP: dict[tuple[str, str], str] = {
    ("kicking", "fieldGoalsMade/fieldGoalAttempts"): "fg_miss_total",
}


def _parse_missed(value: str) -> float:
    try:
        made, attempted = value.split("/")
        return float(attempted) - float(made)
    except (ValueError, IndexError):
        return 0.0

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
                        continue
                    missed_key = _MISSED_MAP.get((category_name, raw_key))
                    if missed_key is not None:
                        entry["stat_line"][missed_key] = entry["stat_line"].get(missed_key, 0) + _parse_missed(raw_value)

    # Merged in separately — _parse_fg_yards_by_player reads a
    # genuinely different part of the response (scoringPlays, not the
    # boxscore statistics tables the loop above walks) — see that
    # function's own docstring. setdefault rather than assuming the
    # player is already in players_by_id: true for every real kicker in
    # practice (they always show up in the kicking category above too),
    # but this stays correct even if that ever isn't the case.
    for espn_player_id, fg_yards in _parse_fg_yards_by_player(data).items():
        entry = players_by_id.setdefault(
            espn_player_id,
            {"espn_player_id": espn_player_id, "player_name": None, "pro_team": None, "stat_line": {}},
        )
        entry["stat_line"]["fg_yds"] = entry["stat_line"].get("fg_yds", 0) + fg_yards

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
