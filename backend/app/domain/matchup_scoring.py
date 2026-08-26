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
_NON_STARTER_SLOTS = ("BE", "IR")


async def compute_team_score(conn, season: int, week: int, team_id: int) -> float:
    rows = await conn.fetch(
        """
        SELECT pws.fantasy_points
        FROM current_rosters cr
        JOIN player_week_stats pws
            ON pws.season = cr.season AND pws.week = $2 AND pws.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND cr.team_id = $3 AND cr.lineup_slot != ALL($4::text[])
        """,
        season, week, team_id, list(_NON_STARTER_SLOTS),
    )
    return round(sum(float(r["fantasy_points"]) for r in rows), 2)


async def compute_matchup_scores_for_week(conn, season: int, week: int) -> int:
    """Recomputes and stores home_score/away_score for every matchup
    already on the books for this season/week (from provider.
    sync_matchups' pairing read — see module docstring). Returns the
    number of matchups updated; 0 (not an error) if no matchups exist
    yet for this week."""
    matchup_rows = await conn.fetch(
        "SELECT id, home_team_id, away_team_id FROM matchups WHERE season = $1 AND week = $2", season, week
    )
    updated = 0
    async with conn.transaction():
        for row in matchup_rows:
            home_score = await compute_team_score(conn, season, week, row["home_team_id"])
            away_score = await compute_team_score(conn, season, week, row["away_team_id"])
            await conn.execute(
                "UPDATE matchups SET home_score = $1, away_score = $2 WHERE id = $3",
                home_score, away_score, row["id"],
            )
            updated += 1
    return updated
