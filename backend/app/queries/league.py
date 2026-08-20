"""
Read queries over the raw synced data (teams/matchups/rosters/rivalries).
Standings is a plain win/loss/points aggregation over `matchups` (with
final_rank layered in when available — see get_standings). The
stats_engine-derived views (team profile, awards) live in
app/domain/ + app/queries/awards.py instead — see MIGRATION_MAP.md.
"""


async def list_seasons(conn):
    rows = await conn.fetch(
        "SELECT DISTINCT season FROM teams_by_season ORDER BY season"
    )
    return [r["season"] for r in rows]


async def get_cached_current_week(conn, season: int):
    """Cached by app/providers/sync.py as a side effect of syncs — see
    the league_state migration. Returns None if no sync has run for this
    season yet (nothing to cache), not an error."""
    return await conn.fetchval(
        "SELECT current_week FROM league_state WHERE season = $1", season
    )


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


async def list_all_owners(conn):
    """Every owner who has ever been in the league — not scoped to any
    one season, unlike list_teams. Used for the home page's owner-card
    grid, which per explicit ask includes everyone with league history,
    not just current-season teams (some owners here have left the
    league entirely)."""
    return await conn.fetch(
        """
        SELECT o.owner_id, o.display_name,
               (
                   SELECT t.team_name FROM teams_by_season t
                   WHERE t.owner_id = o.owner_id
                   ORDER BY t.season DESC LIMIT 1
               ) AS latest_team_name,
               (
                   SELECT array_agg(t.season ORDER BY t.season) FROM teams_by_season t
                   WHERE t.owner_id = o.owner_id
               ) AS seasons
        FROM owners o
        WHERE EXISTS (SELECT 1 FROM teams_by_season t WHERE t.owner_id = o.owner_id)
        ORDER BY o.display_name
        """
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
    #
    # Ordering: final_standings.final_rank (ESPN's own rankCalculatedFinal
    # — accounts for the full playoff bracket) when it exists for this
    # season, falling back to regular-season win/loss/points for a season
    # still in progress (no final rank yet). A team with final_rank == 1
    # is the champion — no separate "champion" concept needed.
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
               COALESCE(SUM(r.points_against), 0) AS points_against,
               fs.final_rank
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        LEFT JOIN results r ON r.team_id = t.id
        LEFT JOIN final_standings fs ON fs.team_id = t.id AND fs.season = t.season
        WHERE t.season = $1
        GROUP BY t.id, t.team_name, o.display_name, fs.final_rank
        ORDER BY
            CASE WHEN fs.final_rank IS NULL THEN 1 ELSE 0 END,
            fs.final_rank,
            wins DESC,
            points_for DESC
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


async def get_rivalry_for_owners(conn, owner_a_id: int, owner_b_id: int):
    """Ported from Fantasy_Helper's bot/memory/rivalry_graph.py
    get_rivalry, unchanged: only owner pairs someone has curated into
    the rivalries table (name/emoji/tagline/tier) match here — most
    matchups won't. See get_head_to_head below for the general,
    always-available record that isn't limited to curated pairs."""
    return await conn.fetchrow(
        """
        SELECT r.*, oa.display_name AS owner_a_name, ob.display_name AS owner_b_name
        FROM rivalries r
        JOIN owners oa ON oa.owner_id = r.owner_a_id
        JOIN owners ob ON ob.owner_id = r.owner_b_id
        WHERE (r.owner_a_id = $1 AND r.owner_b_id = $2) OR (r.owner_a_id = $2 AND r.owner_b_id = $1)
        """,
        owner_a_id, owner_b_id,
    )


async def get_head_to_head(conn, owner_a_id: int, owner_b_id: int):
    """Ported from Fantasy_Helper's scripts/sync_rivalries.py
    compute_head_to_head, unchanged logic — but called live for ANY
    owner pair here, not just curated rivalries (that script only ever
    ran it for the names in rivalry_map.py and cached the result on the
    rivalries row). Same 0-0-means-unplayed exclusion as get_standings."""
    games = await conn.fetch(
        """
        SELECT m.season, m.week,
            CASE WHEN th.owner_id = $1 THEN m.home_score ELSE m.away_score END AS a_score,
            CASE WHEN th.owner_id = $1 THEN m.away_score ELSE m.home_score END AS b_score
        FROM matchups m
        JOIN teams_by_season th ON m.home_team_id = th.id
        JOIN teams_by_season ta ON m.away_team_id = ta.id
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
          AND NOT (m.home_score = 0 AND m.away_score = 0)
          AND ((th.owner_id = $1 AND ta.owner_id = $2) OR (th.owner_id = $2 AND ta.owner_id = $1))
        ORDER BY m.season, m.week
        """,
        owner_a_id, owner_b_id,
    )

    wins_a = sum(1 for g in games if g["a_score"] > g["b_score"])
    wins_b = sum(1 for g in games if g["b_score"] > g["a_score"])
    ties = sum(1 for g in games if g["a_score"] == g["b_score"])
    last_game = games[-1] if games else None

    def _result(g):
        if g["a_score"] > g["b_score"]:
            return "a"
        if g["b_score"] > g["a_score"]:
            return "b"
        return "tie"

    return {
        "wins_a": wins_a,
        "wins_b": wins_b,
        "ties": ties,
        "last_season": last_game["season"] if last_game else None,
        "last_week": last_game["week"] if last_game else None,
        # Oldest-to-newest, matching `games`' own order — most recent last.
        "recent_games": [
            {
                "season": g["season"],
                "week": g["week"],
                "winner": _result(g),
                "a_score": float(g["a_score"]),
                "b_score": float(g["b_score"]),
            }
            for g in games[-5:]
        ],
    }


async def list_rivalries(conn):
    return await conn.fetch(
        """
        SELECT r.id, r.name, r.emoji, r.tagline, r.description, r.tier,
               r.all_time_wins_a, r.all_time_wins_b,
               oa.owner_id AS owner_a_id, oa.display_name AS owner_a_name,
               ob.owner_id AS owner_b_id, ob.display_name AS owner_b_name
        FROM rivalries r
        JOIN owners oa ON oa.owner_id = r.owner_a_id
        JOIN owners ob ON ob.owner_id = r.owner_b_id
        ORDER BY r.tier, r.name
        """
    )
