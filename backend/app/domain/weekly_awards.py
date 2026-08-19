"""
Ported from Fantasy_Helper's bot/awards_engine/weekly_awards.py,
unchanged (see MIGRATION_MAP.md).

Computes the four weekly awards + the boom/bust player leaderboard for
one season/week, league-wide. Meant to be called once per recap.
"""
from app.domain.expected_score import get_expected_score


async def get_overachiever_and_meltdown(conn, season: int, week: int):
    teams = await conn.fetch(
        "SELECT DISTINCT team_id FROM weekly_team_stats WHERE season = $1 AND week = $2",
        season, week,
    )

    results = []
    for t in teams:
        team_id = t["team_id"]
        score = await conn.fetchval(
            """
            SELECT CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END
            FROM matchups WHERE season = $2 AND week = $3 AND (home_team_id = $1 OR away_team_id = $1) AND home_score > 0
            """,
            team_id, season, week,
        )
        if score is None:
            continue

        expected = await get_expected_score(conn, season, week, team_id)
        if expected <= 0:
            continue

        team_name = await conn.fetchval("SELECT team_name FROM teams_by_season WHERE id = $1", team_id)
        results.append({"team_id": team_id, "team_name": team_name, "diff": float(score) - expected})

    if not results:
        return None, None

    overachiever = max(results, key=lambda r: r["diff"])
    meltdown = min(results, key=lambda r: r["diff"])
    return overachiever, meltdown


async def get_biggest_bench_crime(conn, season: int, week: int):
    row = await conn.fetchrow(
        """
        SELECT bc.*, tbs.team_name FROM bench_crimes bc
        JOIN teams_by_season tbs ON bc.team_id = tbs.id
        WHERE bc.season = $1 AND bc.week = $2
        ORDER BY bc.points_diff DESC LIMIT 1
        """,
        season, week,
    )
    return dict(row) if row else None


async def get_clutch_choke_of_week(conn, season: int, week: int):
    matchups = await conn.fetch(
        "SELECT * FROM matchups WHERE season = $1 AND week = $2 AND home_score > 0", season, week
    )

    clutch = None
    choke = None

    for m in matchups:
        for is_home in (True, False):
            team_id = m["home_team_id"] if is_home else m["away_team_id"]
            opp_id = m["away_team_id"] if is_home else m["home_team_id"]
            score = float(m["home_score"] if is_home else m["away_score"])
            won = (m["home_score"] > m["away_score"]) if is_home else (m["away_score"] > m["home_score"])

            expected = await get_expected_score(conn, season, week, team_id)
            opp_expected = await get_expected_score(conn, season, week, opp_id)
            if expected <= 0 or opp_expected <= 0:
                continue

            pct_diff = (score - expected) / expected
            was_underdog = expected < (opp_expected - 10)
            was_favored = expected > (opp_expected + 10)

            team_name = await conn.fetchval("SELECT team_name FROM teams_by_season WHERE id = $1", team_id)

            if won and (pct_diff >= 0.15 or was_underdog):
                margin = pct_diff if pct_diff >= 0.15 else (opp_expected - expected)
                if clutch is None or margin > clutch["margin"]:
                    clutch = {"team_name": team_name, "margin": margin, "reason": "beat projection by 15%+" if pct_diff >= 0.15 else "won as underdog"}

            if not won and (pct_diff <= -0.15 or was_favored):
                margin = abs(pct_diff) if pct_diff <= -0.15 else (expected - opp_expected)
                if choke is None or margin > choke["margin"]:
                    choke = {"team_name": team_name, "margin": margin, "reason": "missed projection by 15%+" if pct_diff <= -0.15 else "lost as the favorite"}

    return clutch, choke


async def get_boom_bust_leaders(conn, season: int, week: int, limit: int = 3):
    booms = await conn.fetch(
        """
        SELECT r.player_name, r.points_scored, tbs.team_name FROM rosters r
        JOIN teams_by_season tbs ON r.team_id = tbs.id
        WHERE r.season = $1 AND r.week = $2 AND r.is_boom = TRUE
        ORDER BY r.points_scored DESC LIMIT $3
        """,
        season, week, limit,
    )
    busts = await conn.fetch(
        """
        SELECT r.player_name, r.points_scored, tbs.team_name FROM rosters r
        JOIN teams_by_season tbs ON r.team_id = tbs.id
        WHERE r.season = $1 AND r.week = $2 AND r.is_bust = TRUE
        ORDER BY r.points_scored ASC LIMIT $3
        """,
        season, week, limit,
    )
    return [dict(b) for b in booms], [dict(b) for b in busts]


async def get_game_of_week_result(conn, season: int, week: int, game_of_week_matchup: dict):
    if not game_of_week_matchup:
        return None
    m = await conn.fetchrow(
        "SELECT * FROM matchups WHERE season = $1 AND week = $2 AND home_team_id = $3 AND away_team_id = $4",
        season, week, game_of_week_matchup["home_team_id"], game_of_week_matchup["away_team_id"],
    )
    if not m or m["home_score"] <= 0:
        return None

    home_won = m["home_score"] > m["away_score"]
    winner_id = m["home_team_id"] if home_won else m["away_team_id"]
    winner_name = await conn.fetchval("SELECT team_name FROM teams_by_season WHERE id = $1", winner_id)
    return {"winner": winner_name, "score": f"{max(m['home_score'], m['away_score'])}-{min(m['home_score'], m['away_score'])}"}
