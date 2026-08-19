"""
Ported from Fantasy_Helper's bot/stats_engine/team_profile.py, unchanged
(see MIGRATION_MAP.md: "EXTRACT / PORT — keep the calculation logic
itself unchanged, it's correct and already tested against real data").

Two profile builders (season-specific and career-wide), splitting
record/points into regular season vs. playoff using matchups.is_playoff.
Best/worst week and best/worst season are regular-season only.
"""


def _summarize(games):
    if not games:
        return None
    wins = sum(1 for g in games if g["my_score"] > g["opp_score"])
    losses = sum(1 for g in games if g["my_score"] < g["opp_score"])
    ties = sum(1 for g in games if g["my_score"] == g["opp_score"])
    pf = sum(float(g["my_score"]) for g in games)
    pa = sum(float(g["opp_score"]) for g in games)
    return {
        "record": f"{wins}-{losses}" + (f"-{ties}" if ties else ""),
        "pf": round(pf, 2), "pa": round(pa, 2),
        "pfpg": round(pf / len(games), 2), "papg": round(pa / len(games), 2),
        "game_count": len(games),
    }


async def build_team_profile(conn, season: int, owner_id: int):
    team_row = await conn.fetchrow(
        "SELECT id AS team_id, team_name FROM teams_by_season WHERE season = $1 AND owner_id = $2",
        season, owner_id,
    )
    if not team_row:
        return None

    team_id = team_row["team_id"]

    games = await conn.fetch(
        """
        SELECT week, is_playoff,
            CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END AS my_score,
            CASE WHEN home_team_id = $1 THEN away_score ELSE home_score END AS opp_score
        FROM matchups
        WHERE season = $2 AND (home_team_id = $1 OR away_team_id = $1) AND home_score > 0
        ORDER BY week
        """,
        team_id, season,
    )
    if not games:
        return None

    regular_games = [g for g in games if not g["is_playoff"]]
    playoff_games = [g for g in games if g["is_playoff"]]

    best = max(regular_games, key=lambda g: g["my_score"]) if regular_games else None
    worst = min(regular_games, key=lambda g: g["my_score"]) if regular_games else None

    stats_row = await conn.fetchrow(
        "SELECT AVG(luck_score) AS avg_luck, AVG(chaos_score) AS avg_chaos FROM weekly_team_stats WHERE season = $1 AND team_id = $2",
        season, team_id,
    )
    current_rank = await conn.fetchval(
        """
        SELECT power_rank FROM weekly_team_stats
        WHERE season = $1 AND team_id = $2 AND power_rank IS NOT NULL
        ORDER BY week DESC LIMIT 1
        """,
        season, team_id,
    )

    return {
        "team_name": team_row["team_name"],
        "regular": _summarize(regular_games),
        "playoff": _summarize(playoff_games),
        "best_week": {"week": best["week"], "score": float(best["my_score"])} if best else None,
        "worst_week": {"week": worst["week"], "score": float(worst["my_score"])} if worst else None,
        "avg_luck": round(float(stats_row["avg_luck"]), 2) if stats_row["avg_luck"] else None,
        "avg_chaos": round(float(stats_row["avg_chaos"]), 2) if stats_row["avg_chaos"] else None,
        "current_power_rank": current_rank,
    }


async def build_career_profile(conn, owner_id: int):
    team_rows = await conn.fetch(
        "SELECT id AS team_id, season, team_name FROM teams_by_season WHERE owner_id = $1 ORDER BY season",
        owner_id,
    )
    if not team_rows:
        return None

    team_ids = [r["team_id"] for r in team_rows]
    seasons = [r["season"] for r in team_rows]
    current_team_name = team_rows[-1]["team_name"]

    games = await conn.fetch(
        """
        SELECT season, week, is_playoff,
            CASE WHEN home_team_id = ANY($1) THEN home_score ELSE away_score END AS my_score,
            CASE WHEN home_team_id = ANY($1) THEN away_score ELSE home_score END AS opp_score
        FROM matchups
        WHERE (home_team_id = ANY($1) OR away_team_id = ANY($1)) AND home_score > 0
        ORDER BY season, week
        """,
        team_ids,
    )
    if not games:
        return None

    regular_games = [g for g in games if not g["is_playoff"]]
    playoff_games = [g for g in games if g["is_playoff"]]

    best = max(regular_games, key=lambda g: g["my_score"]) if regular_games else None
    worst = min(regular_games, key=lambda g: g["my_score"]) if regular_games else None

    # Best/worst SEASON, regular season only -- ranked by win pct, points as tiebreaker
    by_season = {}
    for g in regular_games:
        s = by_season.setdefault(g["season"], {"wins": 0, "losses": 0, "ties": 0, "pf": 0.0})
        if g["my_score"] > g["opp_score"]:
            s["wins"] += 1
        elif g["my_score"] < g["opp_score"]:
            s["losses"] += 1
        else:
            s["ties"] += 1
        s["pf"] += float(g["my_score"])

    best_season = worst_season = None
    if by_season:
        def win_pct(s):
            total = s["wins"] + s["losses"] + s["ties"]
            return (s["wins"] + 0.5 * s["ties"]) / total if total else 0

        best_year = max(by_season, key=lambda y: (win_pct(by_season[y]), by_season[y]["pf"]))
        worst_year = min(by_season, key=lambda y: (win_pct(by_season[y]), by_season[y]["pf"]))

        bs = by_season[best_year]
        ws = by_season[worst_year]
        best_season = {
            "season": best_year,
            "record": f"{bs['wins']}-{bs['losses']}" + (f"-{bs['ties']}" if bs["ties"] else ""),
            "pf": round(bs["pf"], 2),
        }
        worst_season = {
            "season": worst_year,
            "record": f"{ws['wins']}-{ws['losses']}" + (f"-{ws['ties']}" if ws["ties"] else ""),
            "pf": round(ws["pf"], 2),
        }

    return {
        "team_name": current_team_name,
        "seasons": seasons,
        "regular": _summarize(regular_games),
        "playoff": _summarize(playoff_games),
        "best_week": {"season": best["season"], "week": best["week"], "score": float(best["my_score"])} if best else None,
        "worst_week": {"season": worst["season"], "week": worst["week"], "score": float(worst["my_score"])} if worst else None,
        "best_season": best_season,
        "worst_season": worst_season,
    }


async def find_game_of_the_week(conn, season: int, week: int, matchups: list[dict]):
    """
    Picks the matchup with the best combined power rank (lower rank
    number = better team, so we want the LOWEST sum). Returns None if
    not enough power-rank data exists yet (e.g. week 1).

    Each team's rank is its most recent recorded power_rank in this
    season by week number, with no upper bound at the current week —
    that matches the original per-matchup query exactly (it never
    filtered by week <= current), just batched into one query instead
    of two per matchup.
    """
    if not matchups:
        return None

    team_ids = {m["home_team_id"] for m in matchups} | {m["away_team_id"] for m in matchups}
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (team_id) team_id, power_rank
        FROM weekly_team_stats
        WHERE season = $1 AND team_id = ANY($2::int[]) AND power_rank IS NOT NULL
        ORDER BY team_id, week DESC
        """,
        season, list(team_ids),
    )
    ranks = {r["team_id"]: r["power_rank"] for r in rows}

    best_matchup = None
    best_combined_rank = None

    for m in matchups:
        home_rank = ranks.get(m["home_team_id"])
        away_rank = ranks.get(m["away_team_id"])
        if home_rank is None or away_rank is None:
            continue

        combined = home_rank + away_rank
        if best_combined_rank is None or combined < best_combined_rank:
            best_combined_rank = combined
            best_matchup = m

    return best_matchup


async def get_owner_badges(conn, owner_id: int):
    """
    Pulls every championship and seasonal award this owner has ever
    won, for display as profile badges. Grouped by award type so
    repeats show as "3x" instead of three separate lines.
    """
    championships = await conn.fetch(
        "SELECT season FROM season_champions WHERE owner_id = $1 ORDER BY season", owner_id
    )
    awards = await conn.fetch(
        "SELECT season, award_type, detail FROM season_awards WHERE owner_id = $1 ORDER BY season", owner_id
    )

    award_groups = {}
    for a in awards:
        award_groups.setdefault(a["award_type"], []).append(a["season"])

    return {
        "championship_years": [c["season"] for c in championships],
        "award_summary": award_groups,
    }
