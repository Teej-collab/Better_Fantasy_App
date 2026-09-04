"""
Backing queries for the admin Leagues section (app/routers/admin.py's
GET /admin/leagues, GET /admin/leagues/{league_id}).

"Activity" here is approximated via each league's own members' overall
analytics_events, not exact per-event league attribution — Phase 1's
page_view events don't carry a league_id (most routes aren't
unambiguously "about" one league from the URL alone, and a visitor's
active league can change independent of which page they're on), so a
member's activity while their active league happens to be this one is
the closest real signal available today. `feature` events that ARE
inherently league-scoped (league_switched) do carry a real league_id
and could sharpen this in a later phase.
"""
ACTIVE_WINDOW_DAYS = 7


async def list_leagues(conn, days: int) -> list[dict]:
    rows = await conn.fetch(
        f"""
        SELECT l.id, l.name, l.created_at,
               (SELECT count(*) FROM league_members lm WHERE lm.league_id = l.id) AS member_count,
               (
                   SELECT count(*) FROM analytics_events ae
                   JOIN owners o ON o.owner_id = ae.owner_id
                   JOIN league_members lm ON lm.user_id = o.user_id AND lm.league_id = l.id
                   WHERE ae.created_at >= now() - interval '{int(days)} days'
               ) AS recent_events
        FROM leagues l
        ORDER BY recent_events DESC, l.created_at DESC
        """
    )
    return [dict(r) for r in rows]


async def get_league_detail(conn, league_id: int, days: int) -> dict | None:
    league = await conn.fetchrow("SELECT id, name, created_at, invite_code FROM leagues WHERE id = $1", league_id)
    if league is None:
        return None
    result = dict(league)

    members = await conn.fetch(
        f"""
        SELECT lm.user_id, o.owner_id, COALESCE(o.display_name, u.display_name) AS display_name, lm.role,
               lm.joined_at, t.team_name,
               (
                   SELECT max(ae.created_at) FROM analytics_events ae WHERE ae.owner_id = o.owner_id
               ) AS last_active,
               (
                   SELECT count(*) FROM analytics_events ae
                   WHERE ae.owner_id = o.owner_id AND ae.created_at >= now() - interval '{int(days)} days'
               ) AS recent_events
        FROM league_members lm
        JOIN users u ON u.id = lm.user_id
        LEFT JOIN owners o ON o.user_id = lm.user_id
        LEFT JOIN teams_by_season t ON t.owner_id = o.owner_id AND t.league_id = lm.league_id
            AND t.season = (SELECT max(season) FROM teams_by_season WHERE league_id = lm.league_id)
        WHERE lm.league_id = $1
        ORDER BY (lm.role = 'commissioner') DESC, lm.joined_at ASC
        """,
        league_id,
    )
    result["members"] = [dict(r) for r in members]
    return result
