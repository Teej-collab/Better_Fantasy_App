"""
Runs teams/matchups/rosters sync across every season for a given
provider, tolerating partial failure the same way Fantasy_Helper's
refresh_pipeline.py does — one bad season or step doesn't block the rest,
and the caller gets a full picture of what succeeded.

boom_bust, chug_debts, weekly_team_stats, and bench_crimes are all
derived-stats compute steps (not an ESPN fetch — they read whatever's
already synced into `rosters`/`matchups`), included here so they stay
live: every full/live sync recomputes them for that season's actual
data. season_awards is season-scoped rather than per-week (like
final_standings), so it's a full-sync-only step, not part of live sync
— see app/domain/season_awards.py's module docstring for why it's safe
to recompute mid-season.

Order within a season matters: weekly_team_stats' chaos_score reads
is_boom/is_bust, so boom_bust must run first; season_awards reads
weekly_team_stats.team_points_projected (via get_expected_score) and
computes the season champion from final_standings, so it runs last;
chug_standing's accrual reads chug_debts, so it runs after that.

chug_standing's deadline settlement (Jeffrey's Rule doubling — see
app/domain/chug_standing.py) is handled separately from the per-season
step loop above: it only ever makes sense for the single active season
(end_season/end of the range), needs that season's real current week
(only known once, at the point current_week is already being fetched
for league_state below), and needs a real ESPN scoreboard fetch to
check whether Monday Night Football's actual kickoff has passed —
so it's wired in right alongside the existing current_week/league_state
best-effort step in both run_full_sync and run_live_sync, not as a
per-season loop step.
"""
from app.db import get_pool
from app.domain.bench_crimes import compute_bench_crimes_for_season, compute_bench_crimes_for_single_week
from app.domain.boom_bust import compute_boom_bust_for_season, compute_boom_bust_for_single_week
from app.domain.chug_debt import compute_chug_debts_for_season, compute_chug_debts_for_single_week
from app.domain.chug_standing import (
    accrue_weekly_debt_for_season,
    accrue_weekly_debt_for_single_week,
    ensure_chug_deadline_settled,
)
from app.domain.season_awards import compute_season_awards_for_season
from app.domain.weekly_team_stats import (
    compute_weekly_team_stats_for_season,
    compute_weekly_team_stats_for_single_week,
)
from app.providers.base import FantasyProvider
from app.providers.nfl_scoreboard import get_nfl_scoreboard
from app.queries import roster_history as roster_history_queries


async def _update_league_state(pool, season: int, current_week: int) -> None:
    """Caches current_week so pages can read it without hitting ESPN live
    on every request — see league_state migration for the reasoning.
    Also mirrors current_rosters into roster_history for this week (see
    that table's migration) — called here, before the per-season/per-
    week compute-step loops in both run_full_sync and run_live_sync
    below (not after, where this used to sit), specifically so
    boom_bust's is_boom/is_bust writes onto this week's roster_history
    rows later in the same run aren't immediately wiped by a
    delete+reinsert snapshot running after them."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO league_state (season, current_week, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week, updated_at = now()
            """,
            season, current_week,
        )
        await roster_history_queries.snapshot_week(conn, season, current_week)


async def run_full_sync(provider: FantasyProvider, start_season: int, end_season: int) -> dict:
    pool = await get_pool()
    results = {}

    # Fetched and cached up front now (not after the per-season loop,
    # like before) so end_season's roster_history snapshot already
    # exists by the time that season's boom_bust/bench_crimes steps run
    # in the loop below — see _update_league_state's own docstring.
    # end_season is always the active season in every real caller
    # (admin endpoint, scheduler) — historical backfill seasons don't
    # have a meaningful "current week" to cache. Best-effort: one sync
    # step failing here shouldn't fail the whole (still-to-run) sync.
    try:
        current_week = await provider.get_current_week(end_season)
        await _update_league_state(pool, end_season, current_week)
    except Exception as e:
        results.setdefault(end_season, {})["league_state"] = {"status": "failed", "detail": str(e)}
        current_week = None

    for season in range(start_season, end_season + 1):
        season_results = {}
        for step_name, step in (
            ("teams", provider.sync_teams),
            ("matchups", provider.sync_matchups),
            ("rosters", provider.sync_rosters),
            ("boom_bust", compute_boom_bust_for_season),
            ("chug_debts", compute_chug_debts_for_season),
            ("chug_standing_accrual", accrue_weekly_debt_for_season),
            ("weekly_team_stats", compute_weekly_team_stats_for_season),
            ("bench_crimes", compute_bench_crimes_for_season),
            ("final_standings", provider.sync_final_standings),
            ("season_awards", compute_season_awards_for_season),
        ):
            try:
                count = await step(pool, season)
                season_results[step_name] = {"status": "success", "count": count}
            except Exception as e:
                season_results[step_name] = {"status": "failed", "detail": str(e)}
        results[season] = season_results

    if current_week:
        try:
            games = await get_nfl_scoreboard()
            settled = await ensure_chug_deadline_settled(pool, end_season, current_week, games)
            results.setdefault(end_season, {})["chug_deadline_settlement"] = {
                "status": "success", "count": settled,
            }
        except Exception as e:
            results.setdefault(end_season, {})["chug_deadline_settlement"] = {
                "status": "failed", "detail": str(e),
            }

    return results


async def run_live_sync(provider: FantasyProvider, season: int, week: int) -> dict:
    """Fast path for in-game updates: re-syncs one specific week's
    matchups and rosters (not a full season scan) and recomputes
    boom/bust for just that week. Cheap enough to poll frequently during
    live games — see app/scheduler.py's live-sync job."""
    pool = await get_pool()
    results = {}

    # The caller already had to fetch current_week (== week here) to know
    # what to live-sync — reuse it, no extra ESPN call. Done before the
    # step loop below (not after, like before) so this week's
    # roster_history snapshot exists before boom_bust/bench_crimes run
    # against it — see _update_league_state's own docstring.
    try:
        await _update_league_state(pool, season, week)
        results["league_state"] = {"status": "success", "count": week}
    except Exception as e:
        results["league_state"] = {"status": "failed", "detail": str(e)}

    for step_name, step in (
        ("matchups", lambda p, s: provider.sync_matchups_for_week(p, s, week)),
        ("rosters", lambda p, s: provider.sync_rosters_for_week(p, s, week)),
        ("boom_bust", lambda p, s: compute_boom_bust_for_single_week(p, s, week)),
        ("chug_debts", lambda p, s: compute_chug_debts_for_single_week(p, s, week)),
        ("chug_standing_accrual", lambda p, s: accrue_weekly_debt_for_single_week(p, s, week)),
        ("weekly_team_stats", lambda p, s: compute_weekly_team_stats_for_single_week(p, s, week)),
        ("bench_crimes", lambda p, s: compute_bench_crimes_for_single_week(p, s, week)),
    ):
        try:
            count = await step(pool, season)
            results[step_name] = {"status": "success", "count": count}
        except Exception as e:
            results[step_name] = {"status": "failed", "detail": str(e)}

    # A live sync only ever runs while a real NFL game is live (see
    # app/scheduler.py) — including, notably, right around a real Monday
    # night kickoff — so this is exactly when a just-crossed deadline
    # needs to be caught promptly rather than waiting for the next daily
    # full sync. get_nfl_scoreboard() here is a second real ESPN call
    # (the scheduler's own gate already made one to decide to run at
    # all), accepted for the same reason as everywhere else this session:
    # it's the public, unauthenticated endpoint, not the private one.
    try:
        games = await get_nfl_scoreboard()
        settled = await ensure_chug_deadline_settled(pool, season, week, games)
        results["chug_deadline_settlement"] = {"status": "success", "count": settled}
    except Exception as e:
        results["chug_deadline_settlement"] = {"status": "failed", "detail": str(e)}

    return results
