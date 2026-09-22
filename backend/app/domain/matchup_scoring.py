"""
Computes weekly matchup scores from this app's own scoring engine
output (Phase F of the ESPN-independence pivot) — sums each team's
STARTING slots (via league_queries.get_roster_for_week, so a past
week's score always reflects that week's actual frozen lineup, not
today's live roster) player_week_stats.fantasy_points and writes
matchups.home_score/away_score directly, instead of ESPN's fantasy
scoreboard sync.

Decision (see the project plan): matchup PAIRING (who plays whom) still
comes from provider.sync_matchups — it's a read, never had the
cross-owner credential problem this whole pivot exists to fix — this
module only overwrites the score fields once Phase D's scoring engine
has computed the week's points, immediately after.
"""
from app.config import DEFAULT_LEAGUE_ID
from app.queries import league as league_queries

_NON_STARTER_SLOTS = ("BE", "IR")


async def compute_team_score(conn, season: int, week: int, team_id: int) -> float:
    # 2026-09-22 real production bug, confirmed live (real report: a
    # decided week 1 win recorded as a loss, points_for reading wrong —
    # traced to this exact team/week in the DB): this used to join
    # current_rosters straight — the team's LIVE roster right now, not
    # the lineup that actually played in `week`. Any lineup/waiver move
    # made after week N locks silently rewrote week N's already-decided
    # score the next time this function ran for that week (e.g. via
    # the admin recompute endpoint), using players who never started
    # that week. league_queries.get_roster_for_week already solves this
    # exact problem for the roster-display endpoints (live current_rosters
    # only for the season's actual current week, roster_history's real
    # per-week snapshot otherwise, falling back to the nearest earlier
    # snapshot and finally to current_rosters only if none exists yet) —
    # reusing it here instead of duplicating a second, divergent version
    # of that same fallback chain.
    roster = await league_queries.get_roster_for_week(conn, season, team_id, week)
    starters = [r for r in roster if r["lineup_slot"] not in _NON_STARTER_SLOTS]
    return round(sum(float(r["points_scored"]) for r in starters if r["points_scored"] is not None), 2)


async def compute_matchup_scores_for_week(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Recomputes and stores home_score/away_score for every matchup
    already on the books for this season/week (from provider.
    sync_matchups' pairing read — see module docstring). Returns the
    number of matchups updated; 0 (not an error) if no matchups exist
    yet for this week."""
    matchup_rows = await conn.fetch(
        "SELECT id, home_team_id, away_team_id FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3",
        season, week, league_id,
    )
    updated = 0
    async with conn.transaction():
        for row in matchup_rows:
            home_score = await compute_team_score(conn, season, week, row["home_team_id"])
            away_score = await compute_team_score(conn, season, week, row["away_team_id"])
            # Explicit numeric(10,2) cast: matchups.home_score/away_score
            # is an unconstrained `numeric` column, and asyncpg binds a
            # Python float to it as that float's exact binary value, not
            # its rounded decimal string — the round(..., 2) above (and
            # weekly_team_stats.py's own copy of this bug, fixed
            # 2026-09-09) doesn't survive the trip on its own.
            await conn.execute(
                "UPDATE matchups SET home_score = $1::numeric(10,2), away_score = $2::numeric(10,2) WHERE id = $3",
                home_score, away_score, row["id"],
            )
            updated += 1
    return updated
