"""
Read queries over the raw synced data (teams/matchups/rosters) for
Phase 4's core views. Deliberately NOT the stats_engine ports (luck
score, power rank, awards) — those are Phase 6. Standings here is a
plain win/loss/points aggregation over `matchups`, nothing more.
"""


async def list_seasons(conn):
    rows = await conn.fetch(
        "SELECT DISTINCT season FROM teams_by_season ORDER BY season"
    )
    return [r["season"] for r in rows]


async def list_teams(conn, season: int):
    return await conn.fetch(
        """
        SELECT t.id AS team_id, t.espn_team_id, t.team_name,
               o.owner_id, o.display_name AS owner_name
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        WHERE t.season = $1
        ORDER BY t.team_name
        """,
        season,
    )


async def get_team(conn, team_id: int):
    return await conn.fetchrow(
        """
        SELECT t.id AS team_id, t.season, t.espn_team_id, t.team_name,
               o.owner_id, o.display_name AS owner_name
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        WHERE t.id = $1
        """,
        team_id,
    )


async def get_standings(conn, season: int):
    # ESPN returns 0/0 (not NULL) for matchups that haven't been played
    # yet, so IS NOT NULL alone doesn't exclude them — a 0-0 game would
    # otherwise count as a tie. A genuine 0-0 tie is not realistic in
    # fantasy football (some player always scores something), so treat
    # "both scores exactly 0" as "not played yet" too.
    return await conn.fetch(
        """
        WITH results AS (
            SELECT home_team_id AS team_id, home_score AS points_for, away_score AS points_against,
                   (home_score > away_score)::int AS win,
                   (home_score < away_score)::int AS loss,
                   (home_score = away_score)::int AS tie
            FROM matchups
            WHERE season = $1 AND is_playoff = FALSE
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND NOT (home_score = 0 AND away_score = 0)
            UNION ALL
            SELECT away_team_id, away_score, home_score,
                   (away_score > home_score)::int,
                   (away_score < home_score)::int,
                   (away_score = home_score)::int
            FROM matchups
            WHERE season = $1 AND is_playoff = FALSE
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND NOT (home_score = 0 AND away_score = 0)
        )
        SELECT t.id AS team_id, t.team_name, o.display_name AS owner_name,
               COALESCE(SUM(r.win), 0)::int AS wins,
               COALESCE(SUM(r.loss), 0)::int AS losses,
               COALESCE(SUM(r.tie), 0)::int AS ties,
               COALESCE(SUM(r.points_for), 0) AS points_for,
               COALESCE(SUM(r.points_against), 0) AS points_against
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        LEFT JOIN results r ON r.team_id = t.id
        WHERE t.season = $1
        GROUP BY t.id, t.team_name, o.display_name
        ORDER BY wins DESC, points_for DESC
        """,
        season,
    )


async def list_week_matchups(conn, season: int, week: int):
    return await conn.fetch(
        """
        SELECT m.id AS matchup_id, m.is_playoff,
               ht.id AS home_team_id, ht.team_name AS home_team_name, m.home_score,
               at.id AS away_team_id, at.team_name AS away_team_name, m.away_score
        FROM matchups m
        JOIN teams_by_season ht ON m.home_team_id = ht.id
        JOIN teams_by_season at ON m.away_team_id = at.id
        WHERE m.season = $1 AND m.week = $2
        ORDER BY m.id
        """,
        season,
        week,
    )


async def get_matchup(conn, matchup_id: int):
    return await conn.fetchrow(
        """
        SELECT m.id AS matchup_id, m.season, m.week, m.is_playoff,
               ht.id AS home_team_id, ht.team_name AS home_team_name, m.home_score,
               at.id AS away_team_id, at.team_name AS away_team_name, m.away_score
        FROM matchups m
        JOIN teams_by_season ht ON m.home_team_id = ht.id
        JOIN teams_by_season at ON m.away_team_id = at.id
        WHERE m.id = $1
        """,
        matchup_id,
    )


# ESPN's standard lineup order. This league's flex slot is stored as
# "RB/WR/TE" (its actual eligibility), not "FLEX" — confirmed against
# real synced data. Unrecognized slots sort last rather than erroring,
# so an unexpected future slot value doesn't break the page.
_SLOT_ORDER = ["QB", "RB", "WR", "TE", "RB/WR/TE", "D/ST", "K", "BE", "IR"]


async def get_roster(conn, team_id: int, week: int):
    rows = await conn.fetch(
        """
        SELECT player_name, position, lineup_slot, points_scored, points_projected
        FROM rosters
        WHERE team_id = $1 AND week = $2
        """,
        team_id,
        week,
    )
    return sorted(
        rows,
        key=lambda r: (
            _SLOT_ORDER.index(r["lineup_slot"]) if r["lineup_slot"] in _SLOT_ORDER else len(_SLOT_ORDER),
            r["player_name"],
        ),
    )
