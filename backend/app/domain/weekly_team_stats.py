"""
Ported from Fantasy_Helper's bot/stats_engine/power_rank.py, luck.py,
chaos.py, and team_projections.py (calculation logic unchanged) plus
scripts/compute_power_ranks.py, compute_luck_scores.py,
compute_chaos_scores.py, compute_team_projections.py (the write-side
scripts, combined here into one per-week compute step instead of four
separate full-history scans — see MIGRATION_MAP.md).

Fills in five of the weekly_team_stats columns the app actually reads
(power_rank, luck_score, chaos_score, team_points_projected, sos —
clutch_score/choke_score exist in the schema but have no reader
anywhere in this app, same as Fantasy_Helper's own
narrative_engine/recap_embed being out of scope, so they're not
computed here). Scoped to one season/week per call, like boom_bust.py
and chug_debt.py, so it can run as a normal sync-pipeline step instead
of rescanning all of history every time.

Order matters within a week: power_rank/luck_score/chaos_score/sos all
use INSERT ... ON CONFLICT so any of them can create the row first;
power rank and sos additionally depend on final scores existing for
every week up to and including the one being ranked (both only ever
look backward), so they're naturally correct to compute for the
current week once that week's own matchups are in.
team_points_projected has no such dependency — it's summed straight
from that week's own roster rows.
"""


from app.config import DEFAULT_LEAGUE_ID


def _normalize(values: list[float]) -> list[float]:
    """Scales a list of numbers to 0-1, so different metrics can be
    combined fairly even though they're on different scales."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi == lo:
        return [0.5 for _ in values]  # everyone tied, treat as equal
    return [(v - lo) / (hi - lo) for v in values]


def compute_power_ranks(team_stats: list[dict]) -> dict:
    """
    team_stats: list of dicts, one per team, each with:
        team_id, win_pct, avg_points, recent_form
    Returns: {team_id: rank} where rank 1 = best.
    """
    win_pcts = [t["win_pct"] for t in team_stats]
    avg_points = [t["avg_points"] for t in team_stats]
    recent_forms = [t["recent_form"] for t in team_stats]

    norm_win = _normalize(win_pcts)
    norm_avg = _normalize(avg_points)
    norm_recent = _normalize(recent_forms)

    composites = []
    for i, t in enumerate(team_stats):
        composite = (norm_win[i] * 0.5) + (norm_avg[i] * 0.3) + (norm_recent[i] * 0.2)
        composites.append((t["team_id"], composite))

    composites.sort(key=lambda x: x[1], reverse=True)
    return {team_id: rank + 1 for rank, (team_id, _) in enumerate(composites)}


def compute_luck_score(team_score: float, all_scores_this_week: list[float], won: bool) -> float:
    """
    all_scores_this_week: every team's score in the league that week,
    including this team's own score.
    won: whether this team won their actual matchup.

    Returns a score from -50 to 50. Positive = lucky (won despite a
    below-average score). Negative = unlucky (lost despite an
    above-average score). Near 0 = the result matched what the score
    deserved relative to the rest of the league.
    """
    others = [s for s in all_scores_this_week if s != team_score]
    if not others:
        return 0.0

    beat_count = sum(1 for s in others if team_score > s)
    percentile = (beat_count / len(others)) * 100  # 0-100, how many teams you outscored

    deserved_to_win = percentile > 50  # you outscored more than half the league

    if won and not deserved_to_win:
        return round(50 - percentile, 2)       # lucky win, positive
    elif not won and deserved_to_win:
        return round(-(percentile - 50), 2)     # unlucky loss, negative
    else:
        return 0.0                               # result matched the score, no luck involved


def compute_chaos_score(boom_count: int, bust_count: int, total_starters: int) -> float:
    """
    Returns 0-100. Higher = more of the roster swung wildly (booms and
    busts both count as "chaotic" — a week isn't chaotic because it went
    well, it's chaotic because it was unpredictable).
    """
    if total_starters == 0:
        return 0.0
    swung_count = boom_count + bust_count
    return round((swung_count / total_starters) * 100, 2)


async def _upsert_stat(
    conn, season: int, week: int, team_id: int, column: str, value, league_id: int = DEFAULT_LEAGUE_ID
) -> None:
    await conn.execute(
        f"""
        INSERT INTO weekly_team_stats (season, week, team_id, {column}, league_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (season, week, team_id) DO UPDATE SET {column} = EXCLUDED.{column}
        """,
        season, week, team_id, value, league_id,
    )


async def compute_power_ranks_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    team_rows = await conn.fetch(
        "SELECT id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    )

    team_stats = []
    for t in team_rows:
        team_id = t["id"]
        games = await conn.fetch(
            """
            SELECT
                CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END AS my_score,
                CASE WHEN home_team_id = $1 THEN away_score ELSE home_score END AS opp_score
            FROM matchups
            WHERE season = $2 AND week <= $3
              AND (home_team_id = $1 OR away_team_id = $1)
              AND home_score > 0
            ORDER BY week
            """,
            team_id, season, week,
        )
        if not games:
            continue

        wins = sum(1 for g in games if g["my_score"] > g["opp_score"])
        win_pct = wins / len(games)
        avg_points = sum(float(g["my_score"]) for g in games) / len(games)
        recent = games[-3:] if len(games) >= 3 else games
        recent_form = sum(float(g["my_score"]) for g in recent) / len(recent)
        team_stats.append(
            {"team_id": team_id, "win_pct": win_pct, "avg_points": avg_points, "recent_form": recent_form}
        )

    if not team_stats:
        return 0

    ranks = compute_power_ranks(team_stats)
    for t in team_stats:
        await _upsert_stat(conn, season, week, t["team_id"], "power_rank", ranks[t["team_id"]], league_id)
    return len(team_stats)


async def compute_luck_scores_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    matchups = await conn.fetch(
        "SELECT * FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3 AND home_score > 0",
        season, week, league_id,
    )
    if not matchups:
        return 0

    all_scores = []
    for m in matchups:
        all_scores.append(float(m["home_score"]))
        all_scores.append(float(m["away_score"]))

    for m in matchups:
        home_won = m["home_score"] > m["away_score"]
        home_luck = round(compute_luck_score(float(m["home_score"]), all_scores, home_won), 2)
        away_luck = round(compute_luck_score(float(m["away_score"]), all_scores, not home_won), 2)
        await _upsert_stat(conn, season, week, m["home_team_id"], "luck_score", home_luck, league_id)
        await _upsert_stat(conn, season, week, m["away_team_id"], "luck_score", away_luck, league_id)

    return len(matchups) * 2


async def compute_chaos_scores_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    team_rows = await conn.fetch(
        "SELECT DISTINCT team_id FROM rosters WHERE season = $1 AND week = $2 AND league_id = $3",
        season, week, league_id,
    )

    for t in team_rows:
        team_id = t["team_id"]
        starters = await conn.fetch(
            "SELECT is_boom, is_bust FROM rosters WHERE season = $1 AND week = $2 AND team_id = $3 "
            "AND lineup_slot NOT IN ('BE', 'IR')",
            season, week, team_id,
        )
        boom_count = sum(1 for s in starters if s["is_boom"])
        bust_count = sum(1 for s in starters if s["is_bust"])
        chaos = compute_chaos_score(boom_count, bust_count, len(starters))
        await _upsert_stat(conn, season, week, team_id, "chaos_score", chaos, league_id)

    return len(team_rows)


async def compute_sos_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Strength of schedule through this week, regular season only
    (same convention the record book/all-time pages use) — for each
    team, the average win percentage of every opponent it's actually
    played so far. Higher = the team's opponents have collectively won
    more of their own games, i.e. a harder schedule. A team's own
    win_pct (needed as "the opponent's win_pct" when scoring everyone
    else) is computed the same regular-season/played-games-only way
    compute_power_ranks_for_week computes it, just filtered to
    non-playoff games to match the record-book convention."""
    team_rows = await conn.fetch(
        "SELECT id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    )
    team_ids = [t["id"] for t in team_rows]

    win_pct_by_team: dict[int, float] = {}
    for team_id in team_ids:
        games = await conn.fetch(
            """
            SELECT
                CASE WHEN home_team_id = $1 THEN home_score ELSE away_score END AS my_score,
                CASE WHEN home_team_id = $1 THEN away_score ELSE home_score END AS opp_score
            FROM matchups
            WHERE season = $2 AND week <= $3
              AND (home_team_id = $1 OR away_team_id = $1)
              AND is_playoff = FALSE
              AND home_score > 0
            """,
            team_id, season, week,
        )
        if games:
            wins = sum(1 for g in games if g["my_score"] > g["opp_score"])
            win_pct_by_team[team_id] = wins / len(games)

    count = 0
    for team_id in team_ids:
        opponents = await conn.fetch(
            """
            SELECT CASE WHEN home_team_id = $1 THEN away_team_id ELSE home_team_id END AS opponent_id
            FROM matchups
            WHERE season = $2 AND week <= $3
              AND (home_team_id = $1 OR away_team_id = $1)
              AND is_playoff = FALSE
              AND home_score > 0
            """,
            team_id, season, week,
        )
        opp_win_pcts = [win_pct_by_team[o["opponent_id"]] for o in opponents if o["opponent_id"] in win_pct_by_team]
        if not opp_win_pcts:
            continue
        sos = round(sum(opp_win_pcts) / len(opp_win_pcts), 3)
        await _upsert_stat(conn, season, week, team_id, "sos", sos, league_id)
        count += 1
    return count


async def compute_team_projected_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    team_rows = await conn.fetch(
        "SELECT DISTINCT team_id FROM rosters WHERE season = $1 AND week = $2 AND league_id = $3",
        season, week, league_id,
    )

    for t in team_rows:
        team_id = t["team_id"]
        total = await conn.fetchval(
            "SELECT SUM(points_projected) FROM rosters WHERE season = $1 AND week = $2 "
            "AND team_id = $3 AND lineup_slot NOT IN ('BE', 'IR')",
            season, week, team_id,
        )
        projected = round(float(total), 2) if total else 0.0
        await _upsert_stat(conn, season, week, team_id, "team_points_projected", projected, league_id)

    return len(team_rows)


async def compute_weekly_team_stats_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """All five columns for one week, in one call — the normal
    sync-pipeline entry point (see app/providers/sync.py)."""
    counts = [
        await compute_power_ranks_for_week(conn, season, week, league_id),
        await compute_luck_scores_for_week(conn, season, week, league_id),
        await compute_chaos_scores_for_week(conn, season, week, league_id),
        await compute_team_projected_for_week(conn, season, week, league_id),
        await compute_sos_for_week(conn, season, week, league_id),
    ]
    return max(counts)


async def compute_weekly_team_stats_for_season(pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    async with pool.acquire() as conn:
        weeks = await conn.fetch(
            "SELECT DISTINCT week FROM matchups WHERE season = $1 AND league_id = $2 AND home_score > 0 "
            "ORDER BY week",
            season, league_id,
        )
        total = 0
        for w in weeks:
            total += await compute_weekly_team_stats_for_week(conn, season, w["week"], league_id)
    return total


async def compute_weekly_team_stats_for_single_week(pool, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Pool-based single-week entry point for live sync (see
    app/providers/sync.py's run_live_sync)."""
    async with pool.acquire() as conn:
        return await compute_weekly_team_stats_for_week(conn, season, week, league_id)
