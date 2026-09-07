"""
roster_history mirrors current_rosters (this app's real, in-app-drafted
roster) into a real per-week table — see migration e8bedf1ab4b9 for the
full reasoning. snapshot_week is a full replace (delete + reinsert) for
one (season, week), not an additive upsert: called on every full/live
sync tick for whatever week is currently the season's actual current
week (app/providers/sync.py's _update_league_state), it keeps that
week's rows exactly mirroring current_rosters — additions AND
removals — right up until the season rolls over to the next week, at
which point nothing calls snapshot_week for that week number again and
its rows are simply left as they were. That's the whole mechanism:
a week freezes itself the moment it stops being current.

Called before, not after, this week's boom_bust/bench_crimes/chug_debt
compute steps in sync.py (see that file's comments) — those steps write
is_boom/is_bust onto specific roster_history rows for the current week,
and a delete+reinsert snapshot running after them in the same tick
would wipe that write.
"""


async def snapshot_week(conn, season: int, week: int) -> int:
    async with conn.transaction():
        await conn.execute("DELETE FROM roster_history WHERE season = $1 AND week = $2", season, week)
        rows = await conn.fetch(
            """
            INSERT INTO roster_history (season, week, team_id, sleeper_player_id, lineup_slot, points_projected)
            SELECT cr.season, $2, cr.team_id, cr.sleeper_player_id, cr.lineup_slot, p.projected_avg_points
            FROM current_rosters cr
            JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
            WHERE cr.season = $1
            RETURNING id
            """,
            season, week,
        )
    return len(rows)


async def get_latest_snapshotted_week(conn, season: int, team_id: int, week: int) -> int | None:
    """Most recent week <= `week` that has a real snapshot for this
    team — the "assume the same roster unless a change was made" carry-
    forward for a week that predates the very first snapshot ever taken
    (or one skipped by an outage). None if no snapshot exists at or
    before `week` yet."""
    return await conn.fetchval(
        "SELECT MAX(week) FROM roster_history WHERE season = $1 AND team_id = $2 AND week <= $3",
        season, team_id, week,
    )


async def get_roster_history_for_week(conn, season: int, team_id: int, snapshot_week: int, score_week: int) -> list:
    """The frozen roster as of `snapshot_week` (already resolved by
    get_latest_snapshotted_week — this function does no fallback of its
    own), joined to `score_week`'s real player_week_stats. Deliberately
    two different week numbers: composition can be carried forward from
    an earlier snapshot when `score_week` itself was never captured,
    but the score shown is always the actually-requested week's real
    score, never the snapshot week's."""
    return await conn.fetch(
        """
        SELECT p.full_name AS player_name, p.position, rh.lineup_slot,
               pws.fantasy_points AS points_scored, rh.points_projected,
               rh.sleeper_player_id AS player_id, p.pro_team, p.injury_status, rh.is_boom, rh.is_bust
        FROM roster_history rh
        JOIN players p ON p.sleeper_player_id = rh.sleeper_player_id
        LEFT JOIN player_week_stats pws
            ON pws.season = rh.season AND pws.week = $4 AND pws.sleeper_player_id = rh.sleeper_player_id
        WHERE rh.season = $1 AND rh.team_id = $2 AND rh.week = $3
        """,
        season, team_id, snapshot_week, score_week,
    )
