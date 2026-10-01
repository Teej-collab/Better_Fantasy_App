"""
Admin > Recaps — who actually reads each week's recap (2026-10). One
entry per week that has gone live (recap_releases) or been opened, newest
first, with when it was released, how many owners were pushed "LIVE NOW",
and which of the league's owners opened it (recap_opened analytics
events: the recap page, or expanding it on Home) — and which haven't.
"""


async def get_recap_stats(conn, league_id: int, season: int) -> dict:
    league_name = await conn.fetchval("SELECT name FROM leagues WHERE id = $1", league_id)
    members = await conn.fetch(
        """
        SELECT DISTINCT t.owner_id, o.display_name
        FROM teams_by_season t JOIN owners o ON o.owner_id = t.owner_id
        WHERE t.season = $1 AND t.league_id = $2
        ORDER BY o.display_name
        """,
        season, league_id,
    )
    member_ids = [m["owner_id"] for m in members]
    releases = {
        r["week"]: r
        for r in await conn.fetch(
            "SELECT week, released_at, notified_count FROM recap_releases WHERE league_id = $1 AND season = $2",
            league_id, season,
        )
    }
    # metadata values arrive as numbers or strings depending on the
    # client, so compare as text.
    opens = await conn.fetch(
        """
        SELECT (metadata->>'week')::int AS week, owner_id,
               min(created_at) AS first_opened_at, count(*) AS opens,
               (array_agg(metadata->>'source' ORDER BY created_at))[1] AS first_source
        FROM analytics_events
        WHERE event_name = 'recap_opened'
          AND metadata->>'season' = $1::text
          AND (metadata->>'week') ~ '^[0-9]+$'
          AND owner_id = ANY($2::int[])
        GROUP BY 1, 2
        """,
        str(season), member_ids,
    )
    names = {m["owner_id"]: m["display_name"] for m in members}
    by_week: dict[int, list] = {}
    for o in opens:
        by_week.setdefault(o["week"], []).append(o)

    weeks = []
    for week in sorted(set(releases) | set(by_week), reverse=True):
        readers = sorted(by_week.get(week, []), key=lambda o: o["first_opened_at"])
        read_ids = {o["owner_id"] for o in readers}
        release = releases.get(week)
        weeks.append({
            "week": week,
            "released_at": release["released_at"] if release else None,
            "notified": release["notified_count"] if release else 0,
            "member_count": len(members),
            "readers": [
                {
                    "owner_id": o["owner_id"],
                    "display_name": names.get(o["owner_id"], "Unknown"),
                    "first_opened_at": o["first_opened_at"],
                    "opens": o["opens"],
                    "source": o["first_source"],
                }
                for o in readers
            ],
            "not_read": [
                {"owner_id": m["owner_id"], "display_name": m["display_name"]} for m in members if m["owner_id"] not in read_ids
            ],
        })
    return {"league_id": league_id, "league_name": league_name, "season": season, "weeks": weeks}
