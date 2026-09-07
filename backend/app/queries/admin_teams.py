"""Commissioner cleanup for abandoned/duplicate team rows — same
narrow-hard-delete shape as admin_users.get_deletion_blockers/
delete_user, applied to teams_by_season instead of users. Exists for
exactly one real class of problem: an ESPN sync artifact left a
placeholder owner+team (no linked user, no roster, no schedule — see
DELETE /admin/teams/{team_id}'s own docstring for the real 2026-09
incident this was built for), not a general team-offboarding tool. A
team with any real history should never go through here.
"""


async def get_team_deletion_blockers(conn, team_id: int) -> list[str]:
    """Every reason this team can't be safely hard-deleted — an empty
    list means DELETE /admin/teams/{team_id} is safe to call. Checked
    directly against every real FK to teams_by_season(id) in this
    schema (current_rosters.team_id, matchups.home_team_id/
    away_team_id, rosters.team_id, weekly_team_stats.team_id,
    bench_crimes.team_id, trades.proposing_team_id/receiving_team_id,
    trade_assets.from_team_id/to_team_id, final_standings.team_id —
    audited by grepping every migration for "teams_by_season(id)")
    rather than trusting a cascade or Postgres's own FK violation to
    explain itself — a real team should be reassigned (see POST
    /leagues/{id}/teams/{team_id}/reassign), never hard-deleted."""
    blockers = []
    if await conn.fetchval("SELECT 1 FROM current_rosters WHERE team_id = $1", team_id):
        blockers.append("Has players on its current_rosters roster")
    if await conn.fetchval("SELECT 1 FROM matchups WHERE home_team_id = $1 OR away_team_id = $1", team_id):
        blockers.append("Has scheduled matchups")
    if await conn.fetchval("SELECT 1 FROM rosters WHERE team_id = $1", team_id):
        blockers.append("Has legacy ESPN-synced roster rows")
    if await conn.fetchval("SELECT 1 FROM weekly_team_stats WHERE team_id = $1", team_id):
        blockers.append("Has computed weekly team stats")
    if await conn.fetchval("SELECT 1 FROM bench_crimes WHERE team_id = $1", team_id):
        blockers.append("Has bench crime history")
    if await conn.fetchval(
        "SELECT 1 FROM trades WHERE proposing_team_id = $1 OR receiving_team_id = $1", team_id
    ):
        blockers.append("Is party to a trade")
    if await conn.fetchval("SELECT 1 FROM trade_assets WHERE from_team_id = $1 OR to_team_id = $1", team_id):
        blockers.append("Has trade assets attached")
    if await conn.fetchval("SELECT 1 FROM final_standings WHERE team_id = $1", team_id):
        blockers.append("Has final-standings history")
    return blockers


async def delete_team(conn, team_id: int) -> bool | list[str]:
    """Hard-deletes a teams_by_season row with zero linked data.
    Re-validates via get_team_deletion_blockers itself (never trusts a
    caller who already checked) — returns that same non-empty blocker
    list if it's not actually safe, or False if the team doesn't
    exist, so the router can turn either into a clean 409/404 rather
    than a raw delete happening on stale information. Deliberately
    leaves the team's owner row untouched even when this was its only
    team — owners fan out into far more FKs (chat, chug, notifications,
    keepers...) than are worth re-auditing here for what's meant to be
    a narrow, rarely-used cleanup tool."""
    blockers = await get_team_deletion_blockers(conn, team_id)
    if blockers:
        return blockers
    result = await conn.execute("DELETE FROM teams_by_season WHERE id = $1", team_id)
    return result != "DELETE 0"
