"""
Computes weekly matchup scores from this app's own scoring engine
output (Phase F of the ESPN-independence pivot) — sums each team's
STARTING current_rosters slots' player_week_stats.fantasy_points and
writes matchups.home_score/away_score directly, instead of ESPN's
fantasy scoreboard sync.

Decision (see the project plan): matchup PAIRING (who plays whom) still
comes from provider.sync_matchups — it's a read, never had the
cross-owner credential problem this whole pivot exists to fix — this
module only overwrites the score fields once Phase D's scoring engine
has computed the week's points, immediately after.
"""
from app.config import DEFAULT_LEAGUE_ID

_NON_STARTER_SLOTS = ("BE", "IR")


async def compute_team_score(conn, season: int, week: int, team_id: int) -> float:
    # 2026-09-10 real production bug, found live (real report: a
    # player double-counted on My Team, points inflated): the stale
    # comment this replaced said player_week_stats "isn't uniquely
    # keyed per league yet" — that was true when migration 454d8edda612
    # was written, but migration 130f4acc3a50 widened it to UNIQUE
    # (season, week, sleeper_player_id, league_id) specifically so two
    # leagues could each have their own fantasy_points for the same
    # real player/week. This JOIN was never updated to match — without
    # AND pws.league_id = cr.league_id, once a second league had also
    # computed that player's week, this plain (non-LEFT) JOIN matched
    # BOTH leagues' rows, and the sum() below silently added another
    # league's points onto this team's real score. cr.league_id (a
    # roster entry's own league) is exactly the right scope.
    rows = await conn.fetch(
        """
        SELECT pws.fantasy_points
        FROM current_rosters cr
        JOIN player_week_stats pws
            ON pws.season = cr.season AND pws.week = $2 AND pws.sleeper_player_id = cr.sleeper_player_id
            AND pws.league_id = cr.league_id
        WHERE cr.season = $1 AND cr.team_id = $3 AND cr.lineup_slot != ALL($4::text[])
        """,
        season, week, team_id, list(_NON_STARTER_SLOTS),
    )
    return round(sum(float(r["fantasy_points"]) for r in rows), 2)


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
