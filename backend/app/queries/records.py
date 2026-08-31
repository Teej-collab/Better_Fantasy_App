"""
Raw SQL for the all-time record book (app/domain/records.py). Every
query reads straight from matchups/teams_by_season/owners at request
time — no separate "records" table to keep in sync — so a newly-synced
result is reflected the next time anyone loads the page, which is what
makes these genuinely "auto-update the instant a record is broken"
instead of a snapshot that needs a recompute job.

"Unplayed" convention matches app/queries/league.py's get_head_to_head:
a 0-0 matchup means the game hasn't been played yet (not a real 0-0
final), so single-week records exclude those; season totals don't need
the same exclusion since an unplayed week's 0 just doesn't move a sum.

Every query here is also regular-season only (m.is_playoff = FALSE),
matching the convention app/domain/season_awards.py and
app/domain/team_profile.py already use — the record book is meant to
compare seasons on equal footing, and only every team plays the same
number of regular-season games; playoff weeks are a single elimination
bracket a handful of teams reach, so mixing them in would let a
three-week playoff run's score sit next to a fourteen-week regular
season's as if they were the same kind of record.
"""

from app.config import DEFAULT_LEAGUE_ID

_UNPLAYED = "NOT (m.home_score = 0 AND m.away_score = 0)"
_REGULAR_SEASON = "m.is_playoff = FALSE"


async def top_single_week_scores(conn, limit: int, *, descending: bool, league_id: int = DEFAULT_LEAGUE_ID):
    order = "DESC" if descending else "ASC"
    return await conn.fetch(
        f"""
        WITH sides AS (
            SELECT m.season, m.week, m.home_team_id AS team_id, m.home_score AS score
            FROM matchups m
            WHERE m.home_score IS NOT NULL AND {_UNPLAYED} AND {_REGULAR_SEASON} AND m.league_id = $2
            UNION ALL
            SELECT m.season, m.week, m.away_team_id AS team_id, m.away_score AS score
            FROM matchups m
            WHERE m.away_score IS NOT NULL AND {_UNPLAYED} AND {_REGULAR_SEASON} AND m.league_id = $2
        )
        SELECT s.season, s.week, s.score, t.team_name, o.owner_id, o.display_name AS owner_name
        FROM sides s
        JOIN teams_by_season t ON t.id = s.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        ORDER BY s.score {order}
        LIMIT $1
        """,
        limit, league_id,
    )


async def top_blowouts(conn, limit: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        f"""
        SELECT
            m.season, m.week,
            ABS(m.home_score - m.away_score) AS margin,
            CASE WHEN m.home_score >= m.away_score THEN th.team_name ELSE ta.team_name END AS winner_team,
            CASE WHEN m.home_score >= m.away_score THEN oh.owner_id ELSE oa.owner_id END AS winner_owner_id,
            CASE WHEN m.home_score >= m.away_score THEN oh.display_name ELSE oa.display_name END AS winner_owner_name,
            CASE WHEN m.home_score >= m.away_score THEN m.home_score ELSE m.away_score END AS winner_score,
            CASE WHEN m.home_score >= m.away_score THEN ta.team_name ELSE th.team_name END AS loser_team,
            CASE WHEN m.home_score >= m.away_score THEN m.away_score ELSE m.home_score END AS loser_score
        FROM matchups m
        JOIN teams_by_season th ON th.id = m.home_team_id
        JOIN teams_by_season ta ON ta.id = m.away_team_id
        JOIN owners oh ON oh.owner_id = th.owner_id
        JOIN owners oa ON oa.owner_id = ta.owner_id
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND {_UNPLAYED} AND {_REGULAR_SEASON}
          AND m.league_id = $2
        ORDER BY margin DESC
        LIMIT $1
        """,
        limit, league_id,
    )


async def top_season_point_totals(conn, limit: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        f"""
        WITH sides AS (
            SELECT m.season, m.home_team_id AS team_id, m.home_score AS score
            FROM matchups m WHERE m.home_score IS NOT NULL AND {_REGULAR_SEASON} AND m.league_id = $2
            UNION ALL
            SELECT m.season, m.away_team_id AS team_id, m.away_score AS score
            FROM matchups m WHERE m.away_score IS NOT NULL AND {_REGULAR_SEASON} AND m.league_id = $2
        ),
        season_totals AS (
            SELECT season, team_id, SUM(score) AS total_points
            FROM sides
            GROUP BY season, team_id
        )
        SELECT st.season, st.total_points, t.team_name, o.owner_id, o.display_name AS owner_name
        FROM season_totals st
        JOIN teams_by_season t ON t.id = st.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        ORDER BY st.total_points DESC
        LIMIT $1
        """,
        limit, league_id,
    )
