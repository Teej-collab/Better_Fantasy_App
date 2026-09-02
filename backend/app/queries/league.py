"""
Read queries over the raw synced data (teams/matchups/rosters/rivalries).
Standings is a plain win/loss/points aggregation over `matchups` (with
final_rank layered in when available — see get_standings). The
stats_engine-derived views (team profile, awards) live in
app/domain/ + app/queries/awards.py instead — see MIGRATION_MAP.md.

Note: `rivalries` has no league_id yet (it isn't season-scoped, so it
was missed by the Phase 3 migration's season-scoped-table sweep — see
TODO.md's PHASE 9 entry). get_rivalry_for_owners/list_rivalries below
are left unfiltered for now rather than faking a column that doesn't
exist; a real fix needs its own small migration, flagged as a
follow-up rather than solved here.
"""

from app.config import DEFAULT_LEAGUE_ID


async def list_seasons(conn, league_id: int = DEFAULT_LEAGUE_ID):
    rows = await conn.fetch(
        "SELECT DISTINCT season FROM teams_by_season WHERE league_id = $1 ORDER BY season", league_id
    )
    return [r["season"] for r in rows]


async def get_cached_current_week(conn, season: int):
    """Cached by app/providers/sync.py as a side effect of syncs — see
    the league_state migration. Returns None if no sync has run for this
    season yet (nothing to cache), not an error."""
    return await conn.fetchval(
        "SELECT current_week FROM league_state WHERE season = $1", season
    )


async def get_bye_weeks(conn, season: int) -> dict[str, int]:
    """{pro_team_abbr: bye_week} — cached by app/domain/bye_weeks.py's
    sync_bye_weeks(), triggered via POST /admin/sync/bye-weeks. Empty
    dict (not an error) if that sync hasn't run yet for this season."""
    rows = await conn.fetch(
        "SELECT pro_team, bye_week FROM team_bye_weeks WHERE season = $1", season
    )
    return {row["pro_team"]: row["bye_week"] for row in rows}


async def get_team_for_owner(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    """espn_team_id, not our internal serial team_id — that's the ID
    ESPNLineupClient's live reads/plans key off of (see app/routers/me.py's
    /me/team routes)."""
    return await conn.fetchrow(
        "SELECT espn_team_id, team_name FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
        season, owner_id, league_id,
    )


async def list_teams(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT t.id AS team_id, t.espn_team_id, t.team_name,
               o.owner_id, o.display_name AS owner_name
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        WHERE t.season = $1 AND t.league_id = $2
        ORDER BY t.team_name
        """,
        season, league_id,
    )


async def list_all_owners(conn, league_id: int = DEFAULT_LEAGUE_ID):
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
                   WHERE t.owner_id = o.owner_id AND t.league_id = $1
                   ORDER BY t.season DESC LIMIT 1
               ) AS latest_team_name,
               (
                   SELECT array_agg(t.season ORDER BY t.season) FROM teams_by_season t
                   WHERE t.owner_id = o.owner_id AND t.league_id = $1
               ) AS seasons
        FROM owners o
        WHERE EXISTS (SELECT 1 FROM teams_by_season t WHERE t.owner_id = o.owner_id AND t.league_id = $1)
        ORDER BY o.display_name
        """,
        league_id,
    )


async def get_team(conn, team_id: int):
    return await conn.fetchrow(
        """
        SELECT t.id AS team_id, t.season, t.espn_team_id, t.team_name, t.league_id,
               o.owner_id, o.display_name AS owner_name
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        WHERE t.id = $1
        """,
        team_id,
    )


async def get_teams(conn, team_ids: list[int]) -> dict[int, object]:
    """Batched get_team, keyed by team_id — one query for every team in
    `team_ids` instead of one query per team. Exists specifically for
    app/domain/matchup_context.py's build_week_matchup_context, whose
    per-matchup loop used to call get_team (and get_roster, and more)
    fresh for every matchup — a real, measured N+1 (2026-09-02
    SSR-performance finding: this one endpoint took 3.36s for a
    6-matchup week, almost entirely spent on ~40 small sequential
    round-trips to the same handful of tables)."""
    if not team_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT t.id AS team_id, t.season, t.espn_team_id, t.team_name,
               o.owner_id, o.display_name AS owner_name
        FROM teams_by_season t
        JOIN owners o ON t.owner_id = o.owner_id
        WHERE t.id = ANY($1::int[])
        """,
        team_ids,
    )
    return {r["team_id"]: r for r in rows}


async def get_standings(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
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
            WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND NOT (home_score = 0 AND away_score = 0)
            UNION ALL
            SELECT away_team_id, away_score, home_score,
                   (away_score > home_score)::int,
                   (away_score < home_score)::int,
                   (away_score = home_score)::int
            FROM matchups
            WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE
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
        WHERE t.season = $1 AND t.league_id = $2
        GROUP BY t.id, t.team_name, o.display_name, fs.final_rank
        ORDER BY
            CASE WHEN fs.final_rank IS NULL THEN 1 ELSE 0 END,
            fs.final_rank,
            wins DESC,
            points_for DESC
        """,
        season, league_id,
    )


async def get_playoff_team_count(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int | None:
    """How many teams made the playoffs, going by the most recently
    COMPLETED prior season's own real bracket (matchups.is_playoff,
    already synced from ESPN) — not a guess or a hardcoded number, this
    app has no "how many teams make the playoffs" setting stored
    anywhere. Powers the standings page's playoff-line divider
    (2026-08-31 audit: "no visible playoff-picture indicator"). None
    for a brand-new league with no prior season's playoff data yet —
    the caller shows no line rather than a fabricated one."""
    last_playoff_season = await conn.fetchval(
        "SELECT MAX(season) FROM matchups WHERE league_id = $1 AND season < $2 AND is_playoff = TRUE",
        league_id, season,
    )
    if last_playoff_season is None:
        return None
    return await conn.fetchval(
        """
        SELECT COUNT(DISTINCT team_id) FROM (
            SELECT home_team_id AS team_id FROM matchups WHERE league_id = $1 AND season = $2 AND is_playoff = TRUE
            UNION
            SELECT away_team_id AS team_id FROM matchups WHERE league_id = $1 AND season = $2 AND is_playoff = TRUE
        ) t
        """,
        league_id, last_playoff_season,
    )


async def list_week_matchups(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT m.id AS matchup_id, m.is_playoff,
               ht.id AS home_team_id, ht.team_name AS home_team_name, m.home_score,
               at.id AS away_team_id, at.team_name AS away_team_name, m.away_score
        FROM matchups m
        JOIN teams_by_season ht ON m.home_team_id = ht.id
        JOIN teams_by_season at ON m.away_team_id = at.id
        WHERE m.season = $1 AND m.week = $2 AND m.league_id = $3
        ORDER BY m.id
        """,
        season, week, league_id,
    )


async def get_matchup(conn, matchup_id: int):
    return await conn.fetchrow(
        """
        SELECT m.id AS matchup_id, m.season, m.week, m.is_playoff, m.league_id,
               ht.id AS home_team_id, ht.team_name AS home_team_name, m.home_score,
               at.id AS away_team_id, at.team_name AS away_team_name, m.away_score
        FROM matchups m
        JOIN teams_by_season ht ON m.home_team_id = ht.id
        JOIN teams_by_season at ON m.away_team_id = at.id
        WHERE m.id = $1
        """,
        matchup_id,
    )


async def get_matchup_for_team(conn, team_id: int, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    """The one matchup this team plays in a given week — used by the
    "Your Week" homepage hero, which needs a team's own game, not a
    matchup by its own ID."""
    return await conn.fetchrow(
        """
        SELECT m.id AS matchup_id, m.season, m.week, m.is_playoff,
               ht.id AS home_team_id, ht.team_name AS home_team_name, m.home_score,
               at.id AS away_team_id, at.team_name AS away_team_name, m.away_score
        FROM matchups m
        JOIN teams_by_season ht ON m.home_team_id = ht.id
        JOIN teams_by_season at ON m.away_team_id = at.id
        WHERE m.season = $1 AND m.week = $2 AND (m.home_team_id = $3 OR m.away_team_id = $3) AND m.league_id = $4
        """,
        season, week, team_id, league_id,
    )


async def get_team_score_stdev(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> float | None:
    """Standard deviation of real weekly team scores this season, used
    by the win-probability estimate (app/domain/win_probability.py) as
    the league's actual scoring volatility rather than an arbitrary
    guessed constant. Same 0-0-means-unplayed exclusion as elsewhere.
    None until there's enough real data (a single score has no spread)."""
    return await conn.fetchval(
        """
        SELECT stddev_pop(score) FROM (
            SELECT home_score AS score FROM matchups
            WHERE season = $1 AND league_id = $2 AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND NOT (home_score = 0 AND away_score = 0)
            UNION ALL
            SELECT away_score FROM matchups
            WHERE season = $1 AND league_id = $2 AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND NOT (home_score = 0 AND away_score = 0)
        ) scores
        """,
        season, league_id,
    )


# ESPN's standard lineup order. This league's flex slot is stored as
# "RB/WR/TE" (its actual eligibility), not "FLEX" — confirmed against
# real synced data. Unrecognized slots sort last rather than erroring,
# so an unexpected future slot value doesn't break the page.
_SLOT_ORDER = ["QB", "RB", "WR", "TE", "RB/WR/TE", "D/ST", "K", "BE", "IR"]


async def get_roster(conn, team_id: int, week: int):
    rows = await conn.fetch(
        """
        SELECT player_name, position, lineup_slot, points_scored, points_projected,
               espn_player_id AS player_id, pro_team, is_boom, is_bust
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


def _sort_roster_rows(rows):
    return sorted(
        rows,
        key=lambda r: (
            _SLOT_ORDER.index(r["lineup_slot"]) if r["lineup_slot"] in _SLOT_ORDER else len(_SLOT_ORDER),
            r["player_name"],
        ),
    )


async def get_rosters(conn, team_ids: list[int], week: int) -> dict[int, list]:
    """Batched get_roster, keyed by team_id — see get_teams above for
    why this exists. Same per-team sort get_roster already applies,
    just grouped from one fetch instead of one fetch per team."""
    if not team_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT team_id, player_name, position, lineup_slot, points_scored, points_projected,
               espn_player_id AS player_id, pro_team, is_boom, is_bust
        FROM rosters
        WHERE team_id = ANY($1::int[]) AND week = $2
        """,
        team_ids,
        week,
    )
    by_team: dict[int, list] = {tid: [] for tid in team_ids}
    for r in rows:
        by_team[r["team_id"]].append(r)
    return {tid: _sort_roster_rows(team_rows) for tid, team_rows in by_team.items()}


async def get_rostered_players_by_pro_team(
    conn, season: int, week: int, pro_teams: list[str], league_id: int = DEFAULT_LEAGUE_ID
):
    """Every fantasy-rostered player (any owner's team, any lineup slot)
    whose real NFL team is in `pro_teams` — the cross-reference
    Gamecast's fantasy-impact panel needs (app/gamecast/service.py):
    given a live game between two real NFL teams, which fantasy owners
    actually have skin in it. Unlike get_roster (one fantasy team_id at
    a time), this is scoped by real-world pro_team across every fantasy
    team in the league at once."""
    if not pro_teams:
        return []
    return await conn.fetch(
        """
        SELECT r.player_name, r.position, r.lineup_slot, r.points_scored, r.points_projected,
               r.espn_player_id AS player_id, r.pro_team,
               t.id AS team_id, t.team_name, o.owner_id, o.display_name AS owner_name
        FROM rosters r
        JOIN teams_by_season t ON t.id = r.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE t.season = $1 AND r.week = $2 AND r.pro_team = ANY($3::text[]) AND t.league_id = $4
        """,
        season, week, pro_teams, league_id,
    )


async def get_current_rostered_players_by_pro_team(
    conn, season: int, week: int, pro_teams: list[str], league_id: int = DEFAULT_LEAGUE_ID
):
    """Same role as get_rostered_players_by_pro_team above (Gamecast's
    fantasy-impact panel: given a live game between two real NFL teams,
    which fantasy owners have skin in it) but sourced from the
    ESPN-independence pivot's own tables — current_rosters/players for
    who's on which team, player_week_stats for this week's computed
    points (Phase D's own scoring engine, not ESPN's) — instead of the
    legacy ESPN-synced `rosters` table. Keyed by sleeper_player_id
    (returned as player_id), not player_name — current_rosters/players
    always has a real stable id, unlike the old table's partial
    espn_player_id backfill that forced service.py's name-keyed
    workaround.

    LEFT JOINs player_week_stats since a player who hasn't recorded any
    computed stats yet this week (game not started, or Phase D's
    known gaps) should still appear with 0 points, not be silently
    dropped from the panel."""
    if not pro_teams:
        return []
    return await conn.fetch(
        """
        SELECT p.sleeper_player_id AS player_id, p.full_name AS player_name, p.position,
               cr.lineup_slot, p.pro_team, COALESCE(pws.fantasy_points, 0) AS points_scored,
               t.id AS team_id, t.team_name, o.owner_id, o.display_name AS owner_name
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN teams_by_season t ON t.id = cr.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        LEFT JOIN player_week_stats pws
            ON pws.season = cr.season AND pws.week = $2 AND pws.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND p.pro_team = ANY($3::text[]) AND cr.league_id = $4
        """,
        season, week, pro_teams, league_id,
    )


async def get_bench_crimes_by_team(conn, season: int, week: int, team_ids: list[int], league_id: int = DEFAULT_LEAGUE_ID):
    """Every bench_crimes row for a specific set of teams in a week —
    scoped version of what weekly_awards.get_biggest_bench_crime
    computes league-wide, for surfacing a matchup's own crime(s) on the
    matchup detail page rather than only the week's single worst. Rows
    come back ordered by points_diff DESC (worst first) within each
    team, same ordering get_biggest_bench_crime already uses."""
    if not team_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT * FROM bench_crimes
        WHERE season = $1 AND week = $2 AND team_id = ANY($3::int[]) AND league_id = $4
        ORDER BY points_diff DESC
        """,
        season, week, team_ids, league_id,
    )
    by_team: dict[int, list[dict]] = {}
    for r in rows:
        by_team.setdefault(r["team_id"], []).append(dict(r))
    return by_team


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


async def get_head_to_head(conn, owner_a_id: int, owner_b_id: int, league_id: int = DEFAULT_LEAGUE_ID):
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
          AND m.league_id = $3
        ORDER BY m.season, m.week
        """,
        owner_a_id, owner_b_id, league_id,
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
