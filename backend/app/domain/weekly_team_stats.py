"""
Originally ported from Fantasy_Helper's bot/stats_engine/power_rank.py,
luck.py, chaos.py, and team_projections.py; power rank, luck and SoS
were rebuilt in 2026-10 (see POWER_WEIGHTS and compute_luck_score) —
plus
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
from app.domain.roster_source import uses_in_app_rosters
from app.providers.nfl_scoreboard import get_week_scoreboard, is_week_final


# 2026-10 overhaul (the commissioner's call: power rankings "just
# follow the standings"). Rankings now blend five results-based signals,
# each as a z-score across the league so none dominates by scale:
#   - actual win %                     30%  (wins still matter — "balanced")
#   - all-play win %                   25%  (how you'd do vs EVERY team, every week)
#   - points per game                  20%
#   - recent form (last 3, weighted)   15%
#   - average scoring margin           10%
# Results only — no projections or roster strength (also the
# commissioner's call). Ties in the composite go to points per game.
POWER_WEIGHTS = {
    "win_pct": 0.30,
    "all_play_pct": 0.25,
    "avg_points": 0.20,
    "recent_form": 0.15,
    "avg_margin": 0.10,
}
# Most recent week first.
RECENT_FORM_WEIGHTS = (0.5, 0.3, 0.2)


def _zscores(values: list[float]) -> list[float]:
    if not values:
        return []
    mean = sum(values) / len(values)
    sd = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
    if sd == 0:
        return [0.0 for _ in values]
    return [(v - mean) / sd for v in values]


def compute_power_scores(team_stats: list[dict]) -> dict[int, float]:
    """team_stats: one dict per team with team_id plus every
    POWER_WEIGHTS key. Returns {team_id: composite} (higher = better,
    centered on 0)."""
    scores = {t["team_id"]: 0.0 for t in team_stats}
    for key, weight in POWER_WEIGHTS.items():
        for t, z in zip(team_stats, _zscores([float(t[key]) for t in team_stats])):
            scores[t["team_id"]] += weight * z
    return scores


def compute_power_ranks(team_stats: list[dict]) -> dict:
    """{team_id: rank}, rank 1 = best (see POWER_WEIGHTS)."""
    scores = compute_power_scores(team_stats)
    avg_points = {t["team_id"]: t["avg_points"] for t in team_stats}
    ordered = sorted(scores, key=lambda tid: (scores[tid], avg_points[tid]), reverse=True)
    return {team_id: rank + 1 for rank, team_id in enumerate(ordered)}


def recent_form(scores_oldest_first: list[float]) -> float:
    """Weighted average of the last three scores, newest heaviest."""
    recent = list(reversed(scores_oldest_first))[: len(RECENT_FORM_WEIGHTS)]
    if not recent:
        return 0.0
    weights = RECENT_FORM_WEIGHTS[: len(recent)]
    return sum(s * w for s, w in zip(recent, weights)) / sum(weights)


def all_play_pcts(week_scores: dict[int, float]) -> dict[int, float]:
    """One week's {team_id: score} -> {team_id: share of the rest of the
    league that team outscored} (ties count half) — its odds of winning
    that week against a random opponent."""
    out = {}
    for team_id, score in week_scores.items():
        others = [s for tid, s in week_scores.items() if tid != team_id]
        if not others:
            out[team_id] = 0.5
            continue
        beat = sum(1 for s in others if score > s) + 0.5 * sum(1 for s in others if score == s)
        out[team_id] = beat / len(others)
    return out


def compute_luck_score(result: float, all_play_pct: float) -> float:
    """One week's luck on the same -50..50 scale the old Luck Index used
    (so all-time averages stay comparable): 50 x (actual result -
    expected result), where the actual result is 1 / 0.5 / 0 and the
    expected one is the week's all-play win %. Winning with the 3rd-
    worst score in a 12-team league = +45 (very lucky); losing with the
    2nd-best = -45. A season's luck in wins is the sum / 50."""
    return round(50 * (result - all_play_pct), 2)


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


async def regular_season_games(conn, season: int, through_week: int, league_id: int) -> list:
    """Every decided regular-season game through `through_week`."""
    return await conn.fetch(
        """
        SELECT week, home_team_id, away_team_id, home_score, away_score FROM matchups
        WHERE season = $1 AND league_id = $2 AND week <= $3 AND is_playoff = FALSE AND home_score > 0
        ORDER BY week
        """,
        season, league_id, through_week,
    )


def team_season_stats(games) -> dict[int, dict]:
    """Per-team season stats from regular-season games: record, points,
    margin, all-play, recent form, expected wins (sum of weekly all-play
    win %) and the opponents faced. The one place every power-rank /
    luck / SoS number comes from."""
    by_week: dict[int, dict[int, float]] = {}
    for g in games:
        wk = by_week.setdefault(g["week"], {})
        wk[g["home_team_id"]] = float(g["home_score"])
        wk[g["away_team_id"]] = float(g["away_score"])
    all_play = {week: all_play_pcts(scores) for week, scores in by_week.items()}

    stats: dict[int, dict] = {}
    for g in games:
        for me, opp, my_score, opp_score in (
            (g["home_team_id"], g["away_team_id"], float(g["home_score"]), float(g["away_score"])),
            (g["away_team_id"], g["home_team_id"], float(g["away_score"]), float(g["home_score"])),
        ):
            t = stats.setdefault(
                me,
                {"team_id": me, "wins": 0, "losses": 0, "ties": 0, "scores": [], "margins": [], "all_play": [], "opponents": []},
            )
            result = 1.0 if my_score > opp_score else 0.5 if my_score == opp_score else 0.0
            t["wins"] += result == 1.0
            t["losses"] += result == 0.0
            t["ties"] += result == 0.5
            t["scores"].append(my_score)
            t["margins"].append(my_score - opp_score)
            t["all_play"].append(all_play[g["week"]][me])
            t["opponents"].append(opp)
    for t in stats.values():
        n = len(t["scores"])
        t["games"] = n
        t["win_pct"] = (t["wins"] + 0.5 * t["ties"]) / n
        t["all_play_pct"] = sum(t["all_play"]) / n
        t["expected_wins"] = sum(t["all_play"])
        t["luck_wins"] = t["wins"] + 0.5 * t["ties"] - t["expected_wins"]
        t["avg_points"] = sum(t["scores"]) / n
        t["avg_margin"] = sum(t["margins"]) / n
        t["recent_form"] = recent_form(t["scores"])
    return stats


async def _upsert_stat(
    conn, season: int, week: int, team_id: int, column: str, value, league_id: int = DEFAULT_LEAGUE_ID
) -> None:
    # 2026-09-09 fix: `value` is always already Python-`round()`-ed by
    # its caller (see compute_chaos_score/compute_luck_score/
    # compute_team_projected_for_week above), but asyncpg binds a raw
    # Python float to this column's *unconstrained* `numeric` type as
    # that float's exact binary value, not its rounded decimal string —
    # round(x, 2) doesn't survive the trip (real incident, Week 1 2026:
    # chaos_score stored as
    # 77.780000000000001136868377216160297393798828125). Casting to a
    # fixed-scale numeric here forces Postgres itself to round on
    # write, regardless of what precision the driver hands it — the one
    # shared write path for every one of these columns, so this fixes
    # all of them at once rather than patching each caller's rounding.
    await conn.execute(
        f"""
        INSERT INTO weekly_team_stats (season, week, team_id, {column}, league_id)
        VALUES ($1, $2, $3, $4::numeric(10,4), $5)
        ON CONFLICT (season, week, team_id) DO UPDATE SET {column} = EXCLUDED.{column}
        """,
        season, week, team_id, value, league_id,
    )


async def compute_power_ranks_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    stats = team_season_stats(await regular_season_games(conn, season, week, league_id))
    if not stats:
        return 0
    team_stats = list(stats.values())
    ranks = compute_power_ranks(team_stats)
    for t in team_stats:
        await _upsert_stat(conn, season, week, t["team_id"], "power_rank", ranks[t["team_id"]], league_id)
    return len(team_stats)


async def lock_power_ranks_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Power ranks are decided once, as soon as the week's last game is
    final (2026-10: moved up from the Tuesday flip so Monday night's
    recap can talk about the new rankings), and never rewritten after
    that (2026-09-25, commissioner's call: rankings shouldn't shift
    mid-week). Every sync path used to recompute every past week's rank
    on every run, so a later score change (a stat correction, a re-sync)
    could quietly reshuffle an already-published week. No-op once this
    week has ranks."""
    already_ranked = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM weekly_team_stats WHERE season = $1 AND week = $2 AND league_id = $3 "
        "AND power_rank IS NOT NULL)",
        season, week, league_id,
    )
    if already_ranked:
        return 0
    return await compute_power_ranks_for_week(conn, season, week, league_id)


async def compute_luck_scores_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Each team's luck this week: its actual result vs its all-play win
    % (see compute_luck_score)."""
    matchups = await conn.fetch(
        "SELECT * FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3 AND home_score > 0",
        season, week, league_id,
    )
    if not matchups:
        return 0
    scores = {}
    for m in matchups:
        scores[m["home_team_id"]] = float(m["home_score"])
        scores[m["away_team_id"]] = float(m["away_score"])
    expected = all_play_pcts(scores)
    for m in matchups:
        for me, opp in ((m["home_team_id"], m["away_team_id"]), (m["away_team_id"], m["home_team_id"])):
            result = 1.0 if scores[me] > scores[opp] else 0.5 if scores[me] == scores[opp] else 0.0
            await _upsert_stat(conn, season, week, me, "luck_score", compute_luck_score(result, expected[me]), league_id)
    return len(matchups) * 2


async def compute_chaos_scores_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    # 2026-09-24 fix: this only ever read the legacy ESPN-era `rosters`
    # table, but in-app seasons (2026+) keep each week's lineup — and
    # boom_bust.py's is_boom/is_bust flags — in roster_history, so no
    # 2026 team ever got a chaos score. Same branch boom_bust.py,
    # bench_crimes.py and chug_debt.py already use.
    in_app = await uses_in_app_rosters(conn, season)
    if in_app:
        team_rows = await conn.fetch(
            "SELECT DISTINCT rh.team_id FROM roster_history rh JOIN teams_by_season tbs ON tbs.id = rh.team_id "
            "WHERE rh.season = $1 AND rh.week = $2 AND tbs.league_id = $3",
            season, week, league_id,
        )
    else:
        team_rows = await conn.fetch(
            "SELECT DISTINCT team_id FROM rosters WHERE season = $1 AND week = $2 AND league_id = $3",
            season, week, league_id,
        )

    for t in team_rows:
        team_id = t["team_id"]
        table = "roster_history" if in_app else "rosters"
        starters = await conn.fetch(
            f"SELECT is_boom, is_bust FROM {table} WHERE season = $1 AND week = $2 AND team_id = $3 "
            "AND lineup_slot NOT IN ('BE', 'IR', 'TAXI')",
            season, week, team_id,
        )
        boom_count = sum(1 for s in starters if s["is_boom"])
        bust_count = sum(1 for s in starters if s["is_bust"])
        chaos = compute_chaos_score(boom_count, bust_count, len(starters))
        await _upsert_stat(conn, season, week, team_id, "chaos_score", chaos, league_id)

    return len(team_rows)


async def compute_sos_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Strength of schedule through this week, regular season only: the
    average all-play win % of every opponent a team has played (2026-10
    overhaul — was their actual win %, so a schedule full of lucky
    teams looked hard). All-play is how good a team really is: how often
    it would beat any team in the league, week by week. Same 0-1 scale
    as before (higher = harder), so all-time averages stay comparable.
    Remaining schedule strength is computed on read (app/domain/
    power_rankings.py), from the same numbers."""
    stats = team_season_stats(await regular_season_games(conn, season, week, league_id))
    count = 0
    for t in stats.values():
        opp_strength = [stats[o]["all_play_pct"] for o in t["opponents"] if o in stats]
        if not opp_strength:
            continue
        await _upsert_stat(conn, season, week, t["team_id"], "sos", round(sum(opp_strength) / len(opp_strength), 3), league_id)
        count += 1
    return count


async def compute_team_projected_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Sums each team's active current_rosters slots' real, week-specific
    projection (player_weekly_projections, harvested from ESPN's real
    box scores — see that table's migration for why coverage is ~83%,
    not 100%, on any given week), falling back per-player to
    players.projected_avg_points (the season-average proxy) for
    whichever starters that week's harvest didn't cover — 2026-09 fix:
    this used to sum the season-average for every player regardless of
    `week`, so this function's own "for_week" name was a lie; it now
    genuinely varies week to week. Reads current_rosters (this app's own
    real draft/lineup data, not ESPN's own separate, now-disconnected
    league — see app/queries/league.py's get_current_roster docstring)."""
    team_rows = await conn.fetch(
        "SELECT DISTINCT team_id FROM current_rosters WHERE season = $1 AND league_id = $2",
        season, league_id,
    )

    for t in team_rows:
        team_id = t["team_id"]
        total = await conn.fetchval(
            """
            SELECT SUM(COALESCE(pwp.projected_points, p.projected_avg_points))
            FROM current_rosters cr
            JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
            LEFT JOIN player_weekly_projections pwp
                ON pwp.season = cr.season AND pwp.week = $3 AND pwp.sleeper_player_id = cr.sleeper_player_id
            WHERE cr.season = $1 AND cr.team_id = $2 AND cr.lineup_slot NOT IN ('BE', 'IR', 'TAXI')
            """,
            season, team_id, week,
        )
        projected = round(float(total), 2) if total else 0.0
        await _upsert_stat(conn, season, week, team_id, "team_points_projected", projected, league_id)

    return len(team_rows)


async def compute_weekly_team_stats_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """All five columns for one week, in one call — the normal
    sync-pipeline entry point (see app/providers/sync.py).

    2026-09-09 fix: power_rank/luck_score/chaos_score/sos all depend on
    a week's matchup scores being *decided*, not just started — this
    function is called every live-sync tick (every 60s) while a game is
    live, and matchups.home_score now updates live mid-game (this app's
    own ESPN-independent scoring engine), so the first real fantasy
    point of the week used to be enough for these to compute a real
    rank/luck/chaos value off a still-in-progress game (real incident,
    Week 1 2026 kickoff). Gated on nfl_scoreboard.is_week_final instead
    of each function's own `home_score > 0` check. team_points_projected
    has no such dependency (it's a pre-game projection, not derived from
    live scores) so it still computes every tick, live-game or not."""
    games = await get_week_scoreboard(week=week, year=season)
    final = is_week_final(games)
    counts = [
        # Once the week is final, and only once — see
        # lock_power_ranks_for_week.
        await lock_power_ranks_for_week(conn, season, week, league_id) if final else 0,
        await compute_luck_scores_for_week(conn, season, week, league_id) if final else 0,
        await compute_chaos_scores_for_week(conn, season, week, league_id) if final else 0,
        await compute_team_projected_for_week(conn, season, week, league_id),
        await compute_sos_for_week(conn, season, week, league_id) if final else 0,
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
