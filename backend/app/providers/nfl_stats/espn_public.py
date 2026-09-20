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
NOT here (2pt conversions, safeties — def_safety [team, 2pts] and
safety_1pt [individual, 1pt] — neither is in ESPN's boxscore stat
tables at all, only in play-by-play, and unlike the blocked-FG fix
below, no real safety has occurred this season to confirm ESPN's own
play-type tag for one against, so it's deliberately left unimplemented
rather than guessed at).
Field-goal-by-yardage (fg_yds), missed AND blocked field goals by
distance (fg_miss_0_29/30_39/40_49/50_plus), a blocked kick's own
def_block (+2) credit to the blocking team's D/ST, and QB tackles were
all in that gap list and no longer are (2026-09) — see
_parse_fg_yards_by_player, _parse_fg_misses_by_player, and
_parse_def_block_by_team below for how makes/misses/blocks are
actually captured, from genuinely different parts of the same summary
response than the rest of this file reads (QB tackles are scored as a
separate stat_category from general tackles — app/domain/weekly_stats.py,
not this file, does that split, since it needs the player's position,
which this file's per-game stat parsing never looks at).
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

# 2026-09-13 fix, real report: anchored to end-of-string with zero
# tolerance for trailing whitespace — ESPN's own scoringPlays text is
# genuinely inconsistent about this ("Tyler Loop 57 Yd Field Goal " —
# real text, trailing space — vs. "Chase McLaughlin 34 Yd Field Goal",
# no trailing space, both confirmed live from real games the same
# week). `$` alone rejected the trailing-space form outright, silently
# dropping that made field goal from scoring entirely — not a distance-
# specific or team-specific gap, roughly 1 in 4 sampled real makes
# carried the trailing space. `\s*` before the anchor accepts either.
_FG_MADE_TEXT_RE = re.compile(r"(\d+) Yd Field Goal\s*$")


def _single_kicker_lookup(data: dict, team_key: str) -> dict[str, list[int]]:
    """{team identifier: [espn_player_id, ...]} from the boxscore's own
    `kicking` category — this is the ONLY place a real espn_player_id
    for a kicker lives (game totals only, no per-kick distance).
    `team_key` is "abbreviation" (scoringPlays keys its plays by team
    abbreviation) or "id" (drives.previous[].plays[] keys its plays by
    numeric team id instead) — same underlying boxscore.players[]
    entries carry both, so one lookup covers either caller."""
    kicker_by_team: dict[str, list[int]] = {}
    for team_entry in data.get("boxscore", {}).get("players", []):
        team_val = team_entry.get("team", {}).get(team_key)
        if not team_val:
            continue
        for category in team_entry.get("statistics", []):
            if category.get("name") != "kicking":
                continue
            for athlete_entry in category.get("athletes", []):
                espn_player_id = athlete_entry.get("athlete", {}).get("id")
                if espn_player_id is not None:
                    kicker_by_team.setdefault(team_val, []).append(int(espn_player_id))
    return kicker_by_team


def _parse_fg_yards_by_player(data: dict) -> dict[int, float]:
    """{espn_player_id: total yards of MADE field goals this game} —
    real per-kick distances aren't in the boxscore `statistics` tables
    at all (see this module's own docstring on the gap this used to
    be); they're in the separate top-level `scoringPlays` array, e.g.
    {"text": "Brandon Aubrey 41 Yd Field Goal", "type": {"abbreviation":
    "FG"}, "team": {"abbreviation": "DAL"}} — a kicker's NAME and team,
    never an athlete id.

    Real player-ID attribution comes from cross-referencing the
    boxscore's own `kicking` category instead (_single_kicker_lookup),
    which — unlike scoringPlays — DOES carry a real espn_player_id per
    athlete, just without per-kick distance (only game totals). A team
    with exactly one athlete in that category this game gets every one
    of that team's made-FG scoringPlays attributed to them; a team with
    more than one (a backup/emergency kicker mid-game — rare, unverified
    against real data) is skipped entirely rather than guessed at,
    same "safer to undercount than guess" rule the rest of this file
    already follows for def_fum_rec's own known imprecision.

    Misses aren't captured here at all — see _parse_fg_misses_by_player
    for those, which reads a different part of the response entirely
    (misses don't score, so they never appear in scoringPlays)."""
    kicker_by_team = _single_kicker_lookup(data, "abbreviation")

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


_FG_MISS_TIERS: list[tuple[int | None, str]] = [
    (29, "fg_miss_0_29"), (39, "fg_miss_30_39"), (49, "fg_miss_40_49"), (None, "fg_miss_50_plus"),
]

# 2026-09-20 fix, real report: a BLOCKED field goal (type.abbreviation
# == "BFG") was silently worth 0 points instead of this league's real
# fg_miss_* penalty (-1 to -5 depending on distance), because the loop
# below only ever matched "FGM" (an ordinary miss — wide/short) —
# "BFG" != "FGM" so every blocked attempt was skipped outright, never
# even reaching the scoring engine as a stat_category at all. Confirmed
# against the real play that prompted this (event 401872938, week 2
# 2026): Tyler Loop's real 49-yard blocked attempt. Unlike an ordinary
# miss, a blocked kick's own `statYardage` is always 0 (confirmed on
# that same real play) — the real attempt distance only exists in the
# play's free-text `text` field, e.g. "T.Loop 49 yard field goal is
# BLOCKED (C.Granderson), Center-N.Moore, Holder-R.Eckley." — the same
# "distance is only in text" situation _parse_fg_yards_by_player
# already handles for makes (_FG_MADE_TEXT_RE), just a different play
# type and phrasing ("49 yard field goal is BLOCKED", not "49 Yd Field
# Goal"). This league's fg_miss_* rules make no distinction between an
# ordinary miss and a block — both are scored as the same fg_miss_*
# tier by real distance.
_FG_BLOCKED_TEXT_RE = re.compile(r"(\d+)\s+yard\s+field\s+goal\s+is\s+blocked", re.IGNORECASE)


def _parse_fg_misses_by_player(data: dict) -> dict[int, dict[str, float]]:
    """{espn_player_id: {fg_miss_<tier>: count}} for missed OR blocked
    field goals this game, tiered by real distance (2026-09, replacing
    the old flat fg_miss_total). Neither ever appears in `scoringPlays`
    (nothing scored), but both DO appear in the full play-by-play at
    `drives.previous[].plays[]` — an ordinary miss tagged
    `type.abbreviation == "FGM"` with a clean structured `statYardage`
    field (e.g. 44, no text parsing needed); a block tagged
    `type.abbreviation == "BFG"` needing the real distance parsed out
    of `text` instead — see _FG_BLOCKED_TEXT_RE's own comment on why.

    Player attribution reuses the same single-kicker-per-team
    heuristic as _parse_fg_yards_by_player, just keyed by numeric team
    id instead of abbreviation — a missed/blocked-FG play's own
    `teamParticipants` only carries team ids per offense/defense role,
    never an individual athlete id (confirmed against two real misses,
    event 401772830: Chase McLaughlin's 44-yard "Wide Left", Younghoe
    Koo's 44-yard "Wide Right"; and against the real block, event
    401872938: Tyler Loop's 49-yard BLOCKED attempt — all three
    correctly bucketed/attributed)."""
    kicker_by_team_id = _single_kicker_lookup(data, "id")

    misses_by_player: dict[int, dict[str, float]] = {}
    for drive in data.get("drives", {}).get("previous", []):
        for play in drive.get("plays", []):
            type_abbr = play.get("type", {}).get("abbreviation")
            if type_abbr == "FGM":
                yardage = play.get("statYardage")
                if yardage is None:
                    continue
                yardage = int(yardage)
            elif type_abbr == "BFG":
                match = _FG_BLOCKED_TEXT_RE.search(play.get("text", ""))
                if not match:
                    continue
                yardage = int(match.group(1))
            else:
                continue
            offense_team_id = next(
                (p.get("id") for p in play.get("teamParticipants", []) if p.get("type") == "offense"),
                None,
            )
            kickers = kicker_by_team_id.get(offense_team_id, [])
            if len(kickers) != 1:
                continue  # ambiguous (0 or 2+ kickers credited) — skip rather than guess
            bucket = _tier_category(yardage, _FG_MISS_TIERS)
            player_buckets = misses_by_player.setdefault(kickers[0], {})
            player_buckets[bucket] = player_buckets.get(bucket, 0) + 1

    return misses_by_player

# "made/attempted" combined strings (e.g. "3/4").
_MADE_ATTEMPTED_MAP: dict[tuple[str, str], str] = {
    ("kicking", "extraPointsMade/extraPointAttempts"): "xp_made",
}

# Team D/ST aggregate categories — summed across every player on a
# team's own boxscore.players[] entry. Each of these counts toward
# league_scoring_rules' matching category directly (no bucketing).
#
# def_fum_rec is deliberately NOT sourced from here — see
# _parse_def_fum_rec_by_team below for why and how it's actually
# computed (a real 2026-09-10 production incident: this aggregate
# can't distinguish a team recovering the OPPONENT's fumble, a real
# defensive play, from recovering its OWN fumble, which isn't).
_TEAM_DST_STAT_MAP: dict[tuple[str, str], str] = {
    ("defensive", "sacks"): "def_sack",
    # "defensive"/defensiveTouchdowns is ESPN's own umbrella for ANY
    # touchdown scored by a defensive player — a pick-six AND a
    # fumble-return TD both land here. Deliberately NOT also summing
    # ("interceptions", "interceptionTouchdowns") on top of this: real
    # bug report, 2026-09-20 — Devin Lloyd's real interception-return
    # TD (CAR @ ATL, event 401872933) showed up as
    # defensiveTouchdowns=1 in the "defensive" category AND
    # interceptionTouchdowns=1 in the "interceptions" category, the
    # SAME single play tagged in both, and summing both doubled
    # Carolina's real 1 return TD into a credited 2. interceptionTouchdowns
    # is always a subset of defensiveTouchdowns (every pick-six is a
    # defensive TD), so dropping it here loses no real signal.
    ("defensive", "defensiveTouchdowns"): "def_return_td",
    ("interceptions", "interceptions"): "def_int",
    # A kick/punt return TD scores for BOTH the individual returner
    # (see _INDIVIDUAL_STAT_MAP's ret_td) AND the team D/ST unit — this
    # league's own scoring screenshots list "Kickoff/Punt Return TD"
    # under both the Team Defense/Special Teams AND Miscellaneous
    # sections at the same point value, confirming the double-credit
    # is intentional, not a mapping bug. Genuinely additive with
    # defensiveTouchdowns above, unlike interceptionTouchdowns — a
    # returner isn't a "defensive" position player, so ESPN's own
    # "defensive" category never carries their return TD too (confirmed
    # against the same real CAR @ ATL boxscore: CAR's kickReturns/
    # puntReturns categories carry zero touchdowns this game).
    ("kickReturns", "kickReturnTouchdowns"): "def_return_td",
    ("puntReturns", "puntReturnTouchdowns"): "def_return_td",
}

def _team_abbr_by_id(data: dict) -> dict[str, str]:
    """{team_id: team_abbreviation} from the game header's own
    competitors list — shared by every play-by-play parser below that
    needs to turn a numeric team id (all play-by-play ever carries)
    into the abbreviation the rest of this module keys D/ST stat lines
    by."""
    team_abbr_by_id: dict[str, str] = {}
    for competitor in data.get("header", {}).get("competitions", [{}])[0].get("competitors", []):
        team = competitor.get("team", {})
        team_id, abbr = team.get("id"), team.get("abbreviation")
        if team_id and abbr:
            team_abbr_by_id[str(team_id)] = abbr
    return team_abbr_by_id


def _parse_def_block_by_team(data: dict) -> dict[str, int]:
    """{team_abbreviation: count of kicks this team's defense blocked}
    this game — the OTHER side of the same play
    _parse_fg_misses_by_player reads for the kicker's own fg_miss_*
    penalty: this league's def_block (+2) rewards the team that DID
    the blocking, not the team that got blocked. Real report/fix,
    2026-09-20: New Orleans blocked Tyler Loop's real 49-yard attempt
    (event 401872938) and got no credit for it, because nothing sourced
    def_block from anywhere at all.

    Confirmed against that same real play: a blocked-FG play's own
    `teamParticipants` carries one entry with `type == "defense"` (id
    "18", New Orleans — the blocking team) and one with
    `type == "offense"` (id "33", Baltimore — the team that got
    blocked); the defense entry is what this credits.

    Only covers a blocked FIELD GOAL (type.abbreviation == "BFG") —
    this league's own scoring-rules comment describes def_block as
    "blocked punt/PAT/FG", but a blocked punt or blocked PAT wasn't
    available in any real game to confirm ESPN's play-type tag for
    either against (unlike BFG, verified live) — deliberately not
    guessed at, same "safer to undercount than guess wrong" rule the
    rest of this file already follows. A real blocked punt/PAT should
    surface as an undercount here, not a miscredit, until whoever hits
    one confirms the real type tag and this gets extended the same way."""
    team_abbr_by_id = _team_abbr_by_id(data)

    counts: dict[str, int] = {}
    for drive in data.get("drives", {}).get("previous", []):
        for play in drive.get("plays", []):
            if play.get("type", {}).get("abbreviation") != "BFG":
                continue
            defense_team_id = next(
                (p.get("id") for p in play.get("teamParticipants", []) if p.get("type") == "defense"),
                None,
            )
            abbr = team_abbr_by_id.get(str(defense_team_id)) if defense_team_id else None
            if abbr:
                counts[abbr] = counts.get(abbr, 0) + 1

    return counts


def _parse_def_fum_rec_by_team(data: dict) -> dict[str, int]:
    """{team_abbreviation: count of genuine defensive fumble recoveries}
    this game — i.e. recovering the OPPONENT's fumble (a real takeaway),
    as distinct from a team recovering its own fumble (e.g. a kick
    returner's own teammate falling on a muffed return, or a QB falling
    on his own bad snap), which isn't a defensive stat at all.
    boxscore.players[]'s "fumblesRecovered" total (what _TEAM_DST_STAT_MAP
    used to source this from) can't tell the two apart. ESPN's own
    play-by-play can: confirmed against a real 2026-09-10 incident (LAR's
    kickoff-return fumble, recovered by LAR themselves, is tagged just
    "Kickoff" with isTurnover=False; SF's real recovery of a Stafford
    fumble later the same game is tagged
    type.text == "Fumble Recovery (Opponent)" with isTurnover=True) —
    that type text is the one reliable signal ESPN gives for "this team
    recovered someone ELSE's fumble," so that's what this reads instead.
    Credited to play.end.team.id, the team left in possession after the
    play — i.e. the team that recovered it.

    Same "safer to skip than guess" rule as _parse_fg_yards_by_player:
    a live/in-progress game's summary can lack a `drives` key entirely,
    same as it can lack per-kick data — this returns {} rather than
    raising, exactly like that function already does."""
    team_abbr_by_id = _team_abbr_by_id(data)

    counts: dict[str, int] = {}
    for drive in data.get("drives", {}).get("previous", []):
        for play in drive.get("plays", []):
            if play.get("type", {}).get("text") != "Fumble Recovery (Opponent)":
                continue
            recovering_team_id = play.get("end", {}).get("team", {}).get("id")
            abbr = team_abbr_by_id.get(str(recovering_team_id)) if recovering_team_id else None
            if abbr:
                counts[abbr] = counts.get(abbr, 0) + 1

    return counts


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

    for espn_player_id, miss_buckets in _parse_fg_misses_by_player(data).items():
        entry = players_by_id.setdefault(
            espn_player_id,
            {"espn_player_id": espn_player_id, "player_name": None, "pro_team": None, "stat_line": {}},
        )
        for bucket, count in miss_buckets.items():
            entry["stat_line"][bucket] = entry["stat_line"].get(bucket, 0) + count

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

    for abbr, count in _parse_def_fum_rec_by_team(data).items():
        stat_lines.setdefault(abbr, {})
        stat_lines[abbr]["def_fum_rec"] = stat_lines[abbr].get("def_fum_rec", 0) + count

    for abbr, count in _parse_def_block_by_team(data).items():
        stat_lines.setdefault(abbr, {})
        stat_lines[abbr]["def_block"] = stat_lines[abbr].get("def_block", 0) + count

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
