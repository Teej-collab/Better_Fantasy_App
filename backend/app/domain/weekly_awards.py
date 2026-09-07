"""
Weekly awards — same calculation logic as Fantasy_Helper's
bot/awards_engine/weekly_awards.py (ported verbatim originally; see git
history), rewritten here to batch-fetch each week's inputs once instead
of querying per-team/per-matchup in a loop.

Why: the original was fine for a bot generating one recap post per week.
Called fresh on every page view, its ~125 sequential DB round-trips
(mostly repeated `get_expected_score` and team-name lookups inside
loops) took ~7s against a remote pooled Postgres. This version fetches
the same underlying data (weekly_team_stats projections, matchup scores,
team names, power ranks) in a handful of batched queries, then runs the
identical comparisons/thresholds against it in Python. Outputs are
equivalent, not approximated — see tests/test_awards.py.

get_biggest_bench_crime and get_boom_bust_leaders were already single
queries in the original and are unchanged. find_game_of_the_week lives
in app.domain.team_profile (that's where it was in the original bot) —
callers use both modules together, see app/routers/awards.py.
"""


from app.config import DEFAULT_LEAGUE_ID
from app.domain.roster_source import uses_in_app_rosters


async def _load_week_context(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    matchups = await conn.fetch(
        "SELECT * FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3 AND home_score > 0",
        season, week, league_id,
    )

    team_score = {}
    for m in matchups:
        team_score[m["home_team_id"]] = float(m["home_score"])
        team_score[m["away_team_id"]] = float(m["away_score"])

    wts_rows = await conn.fetch(
        "SELECT team_id, team_points_projected FROM weekly_team_stats WHERE season = $1 AND week = $2 "
        "AND league_id = $3",
        season, week, league_id,
    )
    projected = {
        r["team_id"]: float(r["team_points_projected"]) if r["team_points_projected"] else None
        for r in wts_rows
    }
    # Same set of teams the original get_overachiever_and_meltdown considered
    # (sourced from weekly_team_stats, not matchups) — preserved deliberately.
    wts_team_ids = [r["team_id"] for r in wts_rows]

    league_avg = sum(team_score.values()) / len(team_score) if team_score else 0.0

    def expected_score(team_id: int) -> float:
        p = projected.get(team_id)
        return p if p and p > 0 else league_avg

    team_ids = set(team_score) | set(projected)
    team_names = {}
    if team_ids:
        rows = await conn.fetch(
            "SELECT id, team_name FROM teams_by_season WHERE id = ANY($1::int[])", list(team_ids)
        )
        team_names = {r["id"]: r["team_name"] for r in rows}

    return matchups, team_score, wts_team_ids, expected_score, team_names


async def get_overachiever_and_meltdown(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    _, team_score, wts_team_ids, expected_score, team_names = await _load_week_context(conn, season, week, league_id)

    results = []
    for team_id in wts_team_ids:
        score = team_score.get(team_id)
        if score is None:
            continue
        expected = expected_score(team_id)
        if expected <= 0:
            continue
        results.append({"team_id": team_id, "team_name": team_names.get(team_id), "diff": score - expected})

    if not results:
        return None, None

    overachiever = max(results, key=lambda r: r["diff"])
    meltdown = min(results, key=lambda r: r["diff"])
    return overachiever, meltdown


async def get_biggest_bench_crime(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    row = await conn.fetchrow(
        """
        SELECT bc.*, tbs.team_name FROM bench_crimes bc
        JOIN teams_by_season tbs ON bc.team_id = tbs.id
        WHERE bc.season = $1 AND bc.week = $2 AND bc.league_id = $3
        ORDER BY bc.points_diff DESC LIMIT 1
        """,
        season, week, league_id,
    )
    return dict(row) if row else None


def _team_clutch_choke(score: float, won: bool, expected: float, opp_expected: float) -> dict | None:
    """One team's clutch/choke qualification for a single game — pulled
    out of get_clutch_choke_of_week so get_clutch_choke_status_by_team
    (matchup_context.py's per-matchup badge) evaluates the exact same
    rule instead of a second, driftable copy of it. Returns None if
    this team doesn't qualify as either this week."""
    if expected <= 0 or opp_expected <= 0:
        return None

    pct_diff = (score - expected) / expected
    was_underdog = expected < (opp_expected - 10)
    was_favored = expected > (opp_expected + 10)

    if won and (pct_diff >= 0.15 or was_underdog):
        margin = pct_diff if pct_diff >= 0.15 else (opp_expected - expected)
        return {"label": "clutch", "margin": margin, "reason": "beat projection by 15%+" if pct_diff >= 0.15 else "won as underdog"}

    if not won and (pct_diff <= -0.15 or was_favored):
        margin = abs(pct_diff) if pct_diff <= -0.15 else (expected - opp_expected)
        return {"label": "choke", "margin": margin, "reason": "missed projection by 15%+" if pct_diff <= -0.15 else "lost as the favorite"}

    return None


async def get_clutch_choke_of_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    matchups, _, _, expected_score, team_names = await _load_week_context(conn, season, week, league_id)

    clutch = None
    choke = None

    for m in matchups:
        for is_home in (True, False):
            team_id = m["home_team_id"] if is_home else m["away_team_id"]
            opp_id = m["away_team_id"] if is_home else m["home_team_id"]
            score = float(m["home_score"] if is_home else m["away_score"])
            won = (m["home_score"] > m["away_score"]) if is_home else (m["away_score"] > m["home_score"])

            status = _team_clutch_choke(score, won, expected_score(team_id), expected_score(opp_id))
            if status is None:
                continue
            team_name = team_names.get(team_id)

            if status["label"] == "clutch" and (clutch is None or status["margin"] > clutch["margin"]):
                clutch = {"team_name": team_name, "margin": status["margin"], "reason": status["reason"]}
            if status["label"] == "choke" and (choke is None or status["margin"] > choke["margin"]):
                choke = {"team_name": team_name, "margin": status["margin"], "reason": status["reason"]}

    return clutch, choke


async def get_clutch_choke_status_by_team(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    """Per-team clutch/choke status for every team with a played matchup
    this week — same qualification rule get_clutch_choke_of_week uses to
    find the week's single best/worst, just returned for every team
    instead of only the winner. Powers matchup_context.py's per-matchup
    clutch/choke badge (a specific matchup's own two teams), not the
    week's overall champion. Returns {team_id: {"label", "reason"} | None}."""
    matchups, _, _, expected_score, _ = await _load_week_context(conn, season, week, league_id)

    status: dict[int, dict | None] = {}
    for m in matchups:
        for is_home in (True, False):
            team_id = m["home_team_id"] if is_home else m["away_team_id"]
            opp_id = m["away_team_id"] if is_home else m["home_team_id"]
            score = float(m["home_score"] if is_home else m["away_score"])
            won = (m["home_score"] > m["away_score"]) if is_home else (m["away_score"] > m["home_score"])

            result = _team_clutch_choke(score, won, expected_score(team_id), expected_score(opp_id))
            status[team_id] = {"label": result["label"], "reason": result["reason"]} if result else None

    return status


async def get_boom_bust_leaders(conn, season: int, week: int, limit: int = 3, league_id: int = DEFAULT_LEAGUE_ID):
    if await uses_in_app_rosters(conn, season):
        booms = await conn.fetch(
            """
            SELECT p.full_name AS player_name, pws.fantasy_points AS points_scored, tbs.team_name
            FROM roster_history rh
            JOIN players p ON p.sleeper_player_id = rh.sleeper_player_id
            JOIN teams_by_season tbs ON rh.team_id = tbs.id
            LEFT JOIN player_week_stats pws
                ON pws.season = rh.season AND pws.week = rh.week AND pws.sleeper_player_id = rh.sleeper_player_id
            WHERE rh.season = $1 AND rh.week = $2 AND tbs.league_id = $4 AND rh.is_boom = TRUE
            ORDER BY pws.fantasy_points DESC LIMIT $3
            """,
            season, week, limit, league_id,
        )
        busts = await conn.fetch(
            """
            SELECT p.full_name AS player_name, pws.fantasy_points AS points_scored, tbs.team_name
            FROM roster_history rh
            JOIN players p ON p.sleeper_player_id = rh.sleeper_player_id
            JOIN teams_by_season tbs ON rh.team_id = tbs.id
            LEFT JOIN player_week_stats pws
                ON pws.season = rh.season AND pws.week = rh.week AND pws.sleeper_player_id = rh.sleeper_player_id
            WHERE rh.season = $1 AND rh.week = $2 AND tbs.league_id = $4 AND rh.is_bust = TRUE
            ORDER BY pws.fantasy_points ASC LIMIT $3
            """,
            season, week, limit, league_id,
        )
        return [dict(b) for b in booms], [dict(b) for b in busts]

    booms = await conn.fetch(
        """
        SELECT r.player_name, r.points_scored, tbs.team_name FROM rosters r
        JOIN teams_by_season tbs ON r.team_id = tbs.id
        WHERE r.season = $1 AND r.week = $2 AND r.league_id = $4 AND r.is_boom = TRUE
        ORDER BY r.points_scored DESC LIMIT $3
        """,
        season, week, limit, league_id,
    )
    busts = await conn.fetch(
        """
        SELECT r.player_name, r.points_scored, tbs.team_name FROM rosters r
        JOIN teams_by_season tbs ON r.team_id = tbs.id
        WHERE r.season = $1 AND r.week = $2 AND r.league_id = $4 AND r.is_bust = TRUE
        ORDER BY r.points_scored ASC LIMIT $3
        """,
        season, week, limit, league_id,
    )
    return [dict(b) for b in booms], [dict(b) for b in busts]


async def get_game_of_week_result(
    conn, season: int, week: int, game_of_week_matchup: dict, league_id: int = DEFAULT_LEAGUE_ID
):
    if not game_of_week_matchup:
        return None
    m = await conn.fetchrow(
        "SELECT * FROM matchups WHERE season = $1 AND week = $2 AND home_team_id = $3 AND away_team_id = $4 "
        "AND league_id = $5",
        season, week, game_of_week_matchup["home_team_id"], game_of_week_matchup["away_team_id"], league_id,
    )
    if not m or m["home_score"] <= 0:
        return None

    home_won = m["home_score"] > m["away_score"]
    winner_id = m["home_team_id"] if home_won else m["away_team_id"]
    winner_name = await conn.fetchval("SELECT team_name FROM teams_by_season WHERE id = $1", winner_id)
    return {"winner": winner_name, "score": f"{max(m['home_score'], m['away_score'])}-{min(m['home_score'], m['away_score'])}"}
