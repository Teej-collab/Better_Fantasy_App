"""
Ported from Fantasy_Helper's bot/awards_engine/season_awards.py and
determine_and_save_season_awards.py, unchanged (see MIGRATION_MAP.md).

Each compute_* function scores one owner's season on one axis (clutch/
choke counts, over/underachievement vs. expected score, best/worst week,
snakebit/luckiest-win, win/loss streaks, bullseye, highway robbery).
Every underlying query already scopes to real, played, regular-season
games only (home_score > 0 AND is_playoff = FALSE), so running this
mid-season is safe — it just reflects "the season so far" and updates
week over week as more games are played, the same way power_rank/luck/
chaos already behave. determine_and_save_season_awards runs every
owner through every axis and keeps whichever owner scores best on each,
upserting into season_awards (one row per season/award_type). Ties are
broken by whoever's checked first (owner_id order) — simple, and rare
enough in practice not to need more.

get_expected_score (app/domain/expected_score.py) reads
weekly_team_stats.team_points_projected, so
compute_weekly_team_stats_for_week (app/domain/weekly_team_stats.py)
must run before this for the same season — already the pipeline order
in app/providers/sync.py.

season_champions is a separate, much simpler concern also ported here:
one row per season, derived from whichever team has final_rank = 1 in
final_standings (see TODO.md's Phase 4 "third round of feedback" note —
final_rank, not a separate champion concept, is the source of truth).
Only meaningful once a season's final_standings are populated (i.e.
after that season's playoffs finish), so it's a no-op mid-season rather
than an error.
"""
from app.config import DEFAULT_LEAGUE_ID
from app.domain.expected_score import get_expected_score


async def _get_team_id(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchval(
        "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
        season, owner_id, league_id,
    )


async def compute_clutch_choke_counts(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    games = await conn.fetch(
        """
        SELECT m.week,
            CASE WHEN m.home_team_id = $1 THEN m.home_score ELSE m.away_score END AS actual,
            CASE WHEN m.home_team_id = $1 THEN m.home_score > m.away_score ELSE m.away_score > m.home_score END AS won
        FROM matchups m
        WHERE m.season = $2 AND m.home_score > 0 AND m.is_playoff = FALSE
        AND (m.home_team_id = $1 OR m.away_team_id = $1)
        """,
        team_id, season,
    )

    clutch_weeks = 0
    choke_weeks = 0
    for g in games:
        expected = await get_expected_score(conn, season, g["week"], team_id, league_id)
        if expected <= 0:
            continue
        actual = float(g["actual"])
        pct_diff = (actual - expected) / expected

        if pct_diff >= 0.15 and g["won"]:
            clutch_weeks += 1
        if pct_diff <= -0.15 and not g["won"]:
            choke_weeks += 1

    return {"clutch_weeks": clutch_weeks, "choke_weeks": choke_weeks}


async def compute_over_underachiever(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    games = await conn.fetch(
        """
        SELECT m.week, CASE WHEN m.home_team_id = $1 THEN m.home_score ELSE m.away_score END AS actual
        FROM matchups m WHERE m.season = $2 AND m.home_score > 0 AND m.is_playoff = FALSE
        AND (m.home_team_id = $1 OR m.away_team_id = $1)
        """,
        team_id, season,
    )
    if not games:
        return None

    total_diff = 0.0
    for g in games:
        expected = await get_expected_score(conn, season, g["week"], team_id, league_id)
        total_diff += float(g["actual"]) - expected

    return round(total_diff, 2)


async def compute_boom_bust_weeks(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    row = await conn.fetchrow(
        """
        SELECT
            MAX(CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END) AS best_week,
            MIN(CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END) AS worst_week
        FROM matchups WHERE season = $2 AND (home_team_id = $1 OR away_team_id = $1)
        AND home_score > 0 AND is_playoff = FALSE
        """,
        team_id, season,
    )
    if not row or row["best_week"] is None:
        return None

    return {"best_week": float(row["best_week"]), "worst_week": float(row["worst_week"])}


async def compute_snakebit_and_luck_extremes(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    losses = await conn.fetchval(
        """
        SELECT MAX(CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END)
        FROM matchups WHERE season = $2 AND home_score > 0 AND is_playoff = FALSE
        AND ((home_team_id = $1 AND home_score < away_score) OR (away_team_id = $1 AND away_score < home_score))
        """,
        team_id, season,
    )
    wins = await conn.fetchval(
        """
        SELECT MIN(CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END)
        FROM matchups WHERE season = $2 AND home_score > 0 AND is_playoff = FALSE
        AND ((home_team_id = $1 AND home_score > away_score) OR (away_team_id = $1 AND away_score > home_score))
        """,
        team_id, season,
    )

    return {
        "snakebit_score": float(losses) if losses else None,
        "luckiest_win_score": float(wins) if wins else None,
    }


async def compute_longest_streaks(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    games = await conn.fetch(
        """
        SELECT week, CASE WHEN home_team_id = $1 THEN home_score > away_score ELSE away_score > home_score END AS won
        FROM matchups WHERE season = $2 AND (home_team_id = $1 OR away_team_id = $1)
        AND home_score > 0 AND is_playoff = FALSE
        ORDER BY week
        """,
        team_id, season,
    )
    if not games:
        return None

    longest_win_streak = longest_loss_streak = 0
    current_win = current_loss = 0

    for g in games:
        if g["won"]:
            current_win += 1
            current_loss = 0
        else:
            current_loss += 1
            current_win = 0
        longest_win_streak = max(longest_win_streak, current_win)
        longest_loss_streak = max(longest_loss_streak, current_loss)

    return {"longest_win_streak": longest_win_streak, "longest_loss_streak": longest_loss_streak}


async def compute_bullseye(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    games = await conn.fetch(
        """
        SELECT m.week, CASE WHEN m.home_team_id = $1 THEN m.home_score ELSE m.away_score END AS actual
        FROM matchups m WHERE m.season = $2 AND m.home_score > 0 AND m.is_playoff = FALSE
        AND (m.home_team_id = $1 OR m.away_team_id = $1)
        """,
        team_id, season,
    )
    if not games:
        return None

    count = 0
    for g in games:
        expected = await get_expected_score(conn, season, g["week"], team_id, league_id)
        if expected <= 0:
            continue
        if abs(float(g["actual"]) - expected) <= 0.5:
            count += 1

    return count


async def compute_highway_robbery(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    team_id = await _get_team_id(conn, season, owner_id, league_id)
    if not team_id:
        return None

    wins = await conn.fetch(
        """
        SELECT m.week, m.home_team_id, m.away_team_id
        FROM matchups m WHERE m.season = $2 AND m.home_score > 0 AND m.is_playoff = FALSE
        AND ((m.home_team_id = $1 AND m.home_score > m.away_score) OR (m.away_team_id = $1 AND m.away_score > m.home_score))
        """,
        team_id, season,
    )

    biggest_week, biggest_gap = None, None
    for g in wins:
        opp_id = g["away_team_id"] if g["home_team_id"] == team_id else g["home_team_id"]
        my_expected = await get_expected_score(conn, season, g["week"], team_id, league_id)
        opp_expected = await get_expected_score(conn, season, g["week"], opp_id, league_id)

        if my_expected < opp_expected:
            gap = opp_expected - my_expected
            if biggest_gap is None or gap > biggest_gap:
                biggest_gap, biggest_week = gap, g["week"]

    if biggest_week is None:
        return None
    return {"week": biggest_week, "projection_gap": round(biggest_gap, 2)}


async def determine_and_save_season_awards(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    owner_rows = await conn.fetch(
        "SELECT DISTINCT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    )
    owner_ids = [r["owner_id"] for r in owner_rows]

    winners: dict = {}  # award_type -> (owner_id, detail, value)

    def consider(award_type, owner_id, value, detail, better):
        if value is None:
            return
        current = winners.get(award_type)
        if current is None or better(value, current[2]):
            winners[award_type] = (owner_id, detail, value)

    for owner_id in owner_ids:
        cc = await compute_clutch_choke_counts(conn, season, owner_id, league_id)
        if cc:
            consider("Clutch Performer", owner_id, cc["clutch_weeks"], f"{cc['clutch_weeks']} clutch weeks", lambda a, b: a > b)
            consider("Choke Artist", owner_id, cc["choke_weeks"], f"{cc['choke_weeks']} choke weeks", lambda a, b: a > b)

        diff = await compute_over_underachiever(conn, season, owner_id, league_id)
        if diff is not None:
            consider("Overachiever", owner_id, diff, f"+{diff} pts vs. expected", lambda a, b: a > b)
            consider("Underachiever", owner_id, diff, f"{diff} pts vs. expected", lambda a, b: a < b)

        bb = await compute_boom_bust_weeks(conn, season, owner_id, league_id)
        if bb:
            consider("Boom Week", owner_id, bb["best_week"], f"{bb['best_week']} pts", lambda a, b: a > b)
            consider("Bust Week", owner_id, bb["worst_week"], f"{bb['worst_week']} pts", lambda a, b: a < b)

        snake = await compute_snakebit_and_luck_extremes(conn, season, owner_id, league_id)
        if snake:
            if snake["snakebit_score"] is not None:
                consider("Snakebit Award", owner_id, snake["snakebit_score"], f"{snake['snakebit_score']} pts in a loss", lambda a, b: a > b)
            if snake["luckiest_win_score"] is not None:
                consider("Luckiest Win", owner_id, snake["luckiest_win_score"], f"won with only {snake['luckiest_win_score']} pts", lambda a, b: a < b)

        streaks = await compute_longest_streaks(conn, season, owner_id, league_id)
        if streaks:
            consider("Heater", owner_id, streaks["longest_win_streak"], f"{streaks['longest_win_streak']}-game win streak", lambda a, b: a > b)
            consider("Cold Streak", owner_id, streaks["longest_loss_streak"], f"{streaks['longest_loss_streak']}-game losing streak", lambda a, b: a > b)

        bullseye = await compute_bullseye(conn, season, owner_id, league_id)
        if bullseye:
            consider("Bullseye Award", owner_id, bullseye, f"{bullseye} weeks within 0.5 pts", lambda a, b: a > b)

        robbery = await compute_highway_robbery(conn, season, owner_id, league_id)
        if robbery:
            consider("Highway Robbery", owner_id, robbery["projection_gap"], f"upset by {robbery['projection_gap']} pts (week {robbery['week']})", lambda a, b: a > b)

    for award_type, (owner_id, detail, _value) in winners.items():
        await conn.execute(
            """
            INSERT INTO season_awards (season, owner_id, award_type, detail, league_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (season, award_type, league_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, detail = EXCLUDED.detail
            """,
            season, owner_id, award_type, detail, league_id,
        )

    return winners


async def compute_season_champion(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> bool:
    """No-op (returns False) until final_standings has a final_rank = 1
    row for this season — i.e. mid-season, before that season's
    playoffs have finished."""
    row = await conn.fetchrow(
        """
        SELECT t.owner_id, t.team_name FROM final_standings fs
        JOIN teams_by_season t ON fs.team_id = t.id
        WHERE fs.season = $1 AND fs.final_rank = 1 AND fs.league_id = $2
        """,
        season, league_id,
    )
    if not row:
        return False

    await conn.execute(
        """
        INSERT INTO season_champions (season, owner_id, team_name, league_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (season, league_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, team_name = EXCLUDED.team_name
        """,
        season, row["owner_id"], row["team_name"], league_id,
    )
    return True


async def compute_season_awards_for_season(pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Season-scoped sync-pipeline entry point (see
    app/providers/sync.py's run_full_sync) — not part of live sync,
    same as final_standings, since neither is meaningfully "per current
    week." Safe to run every full sync regardless of how much of the
    season has actually been played (see module docstring)."""
    async with pool.acquire() as conn:
        winners = await determine_and_save_season_awards(conn, season, league_id)
        await compute_season_champion(conn, season, league_id)
    return len(winners)
