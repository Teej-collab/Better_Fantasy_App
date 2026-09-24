"""
Read queries over the raw synced data (teams/matchups/rosters/rivalries).
Standings is a plain win/loss/points aggregation over `matchups` (with
final_rank layered in when available — see get_standings). The
stats_engine-derived views (team profile, awards) live in
app/domain/ + app/queries/awards.py instead — see MIGRATION_MAP.md.

"""

from app.config import DEFAULT_LEAGUE_ID
from app.providers.nfl_scoreboard import get_week_scoreboard, is_week_final
from app.queries import roster_history as roster_history_queries


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
               o.owner_id, o.display_name AS owner_name, o.logo_url
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
               o.owner_id, o.display_name AS owner_name, o.logo_url
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
    # 2026-09-09 fix: that 0-0 exclusion isn't enough once a game is
    # actually under way — matchups.home_score/away_score now update
    # live, in-progress, every sync tick (app/domain/matchup_scoring.py),
    # so a single early point already makes `home_score > 0` true and a
    # live, undecided game was being counted as a real win/loss (real
    # incident, Week 1 2026 kickoff: standings showed 1-0/0-1 records
    # before any game had finished). The currently-active week's real
    # NFL slate has to actually be complete (nfl_scoreboard.is_week_final)
    # before its matchups count toward a team's record — every other
    # week is either already fully played (safe to trust) or still all
    # 0-0 (already excluded above), so only that one week ever needs the
    # live check.
    current_week = await conn.fetchval(
        "SELECT current_week FROM league_state WHERE season = $1", season,
    )
    exclude_week = None
    if current_week is not None:
        games = await get_week_scoreboard(week=current_week, year=season)
        if not is_week_final(games):
            exclude_week = current_week

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
              AND week IS DISTINCT FROM $3
            UNION ALL
            SELECT away_team_id, away_score, home_score,
                   (away_score > home_score)::int,
                   (away_score < home_score)::int,
                   (away_score = home_score)::int
            FROM matchups
            WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND NOT (home_score = 0 AND away_score = 0)
              AND week IS DISTINCT FROM $3
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
        -- 2026-09-24: a tie counts as half a win (standard fantasy
        -- rule, commissioner's call). With no ties this is the same
        -- order as sorting by wins alone.
        ORDER BY
            CASE WHEN fs.final_rank IS NULL THEN 1 ELSE 0 END,
            fs.final_rank,
            COALESCE(SUM(r.win), 0) + 0.5 * COALESCE(SUM(r.tie), 0) DESC,
            points_for DESC
        """,
        season, league_id, exclude_week,
    )


async def get_playoff_team_count(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int | None:
    """How many teams make the playoffs THIS season — an explicit
    commissioner setting (league_playoff_settings, PUT /league/
    playoff-settings) if one exists for this exact season, since
    2026-09-03; otherwise falls back to inferring it from the most
    recently COMPLETED prior season's own real bracket (matchups.
    is_playoff, already synced from ESPN), same as always. Powers the
    standings page's playoff-line divider (2026-08-31 audit: "no
    visible playoff-picture indicator"). None if neither an explicit
    setting nor any prior season's playoff data exists yet — the
    caller shows no line rather than a fabricated one."""
    explicit = await conn.fetchval(
        "SELECT playoff_team_count FROM league_playoff_settings WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    if explicit is not None:
        return explicit

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


async def get_playoff_settings(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    """playoff_team_count (see get_playoff_team_count's own fallback
    chain above) plus weeks_per_matchup/start_week — the two real
    settings (this league's own ESPN screenshot: "Playoff Teams: 4,
    Weeks Per Playoff Matchup: 2") that were never persisted anywhere
    before app/domain/playoffs.py existed. Unlike playoff_team_count,
    these two have no cross-season inference — a league that's never
    touched them gets the plain column defaults (weeks_per_matchup=1,
    start_week=None, meaning "infer from this season's own regular-
    season matchups at generation time" — see playoffs.py)."""
    playoff_team_count = await get_playoff_team_count(conn, season, league_id)
    row = await conn.fetchrow(
        "SELECT weeks_per_matchup, start_week FROM league_playoff_settings WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    return {
        "playoff_team_count": playoff_team_count,
        "weeks_per_matchup": row["weeks_per_matchup"] if row else 1,
        "start_week": row["start_week"] if row else None,
    }


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


def _sort_roster_rows(rows):
    return sorted(
        rows,
        key=lambda r: (
            _SLOT_ORDER.index(r["lineup_slot"]) if r["lineup_slot"] in _SLOT_ORDER else len(_SLOT_ORDER),
            r["player_name"],
        ),
    )


# The real, in-app roster/scoring equivalent of the old, now-deleted
# legacy get_roster/get_rosters (which read `rosters` — see git history
# if you need them) — reads current_rosters (this app's own draft/lineup system,
# app/domain/lineup_engine.py) joined with players and
# player_week_stats, instead of the `rosters` table synced from ESPN's
# OWN, entirely separate league. 2026-09 fix: this league's real draft
# now happens in this app, not on ESPN — `rosters` still gets synced
# from ESPN's own (stale, disconnected) box scores, which drifted
# completely from reality the moment ESPN's own league auto-rostered
# its own copies of these players. Every current-season, "what's
# happening this week" view (the homepage hero — app/domain/
# your_week.py — and the matchup screen — app/domain/
# matchup_context.py) should read through here instead.
#
# points_projected prefers a real, week-specific number from
# player_weekly_projections (harvested from ESPN's box_scores() by
# app/providers/espn/adapter.py's _save_lineup — see that table's own
# migration for why this only covers ~83% of a real roster on any given
# week, not 100%), falling back to players.projected_avg_points (ESPN's
# season-long per-game average) for whichever players that week's
# harvest didn't cover. is_boom/is_bust always come back False: that
# classification (app/domain/boom_bust.py) is still computed against
# the legacy `rosters` table only and hasn't been ported to
# current_rosters yet — a real, known follow-up, not silently
# fabricated data.
async def get_current_roster(conn, season: int, team_id: int, week: int):
    rows = await conn.fetch(
        """
        SELECT p.full_name AS player_name, p.position, cr.lineup_slot,
               pws.fantasy_points AS points_scored, pws.raw_stats,
               COALESCE(pwp.projected_points, p.projected_avg_points) AS points_projected,
               cr.sleeper_player_id AS player_id, p.pro_team, p.injury_status, FALSE AS is_boom, FALSE AS is_bust
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        LEFT JOIN player_week_stats pws
            ON pws.season = cr.season AND pws.week = $3 AND pws.sleeper_player_id = cr.sleeper_player_id
            AND pws.league_id = cr.league_id
        LEFT JOIN player_weekly_projections pwp
            ON pwp.season = cr.season AND pwp.week = $3 AND pwp.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND cr.team_id = $2
        """,
        season, team_id, week,
    )
    return _sort_roster_rows(rows)


async def get_current_rosters(conn, season: int, team_ids: list[int], week: int) -> dict[int, list]:
    """Batched get_current_roster, keyed by team_id — same shape/reason
    get_rosters exists alongside get_roster above."""
    if not team_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT cr.team_id, p.full_name AS player_name, p.position, cr.lineup_slot,
               pws.fantasy_points AS points_scored,
               COALESCE(pwp.projected_points, p.projected_avg_points) AS points_projected,
               cr.sleeper_player_id AS player_id, p.pro_team, p.injury_status, FALSE AS is_boom, FALSE AS is_bust
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        LEFT JOIN player_week_stats pws
            ON pws.season = cr.season AND pws.week = $3 AND pws.sleeper_player_id = cr.sleeper_player_id
            AND pws.league_id = cr.league_id
        LEFT JOIN player_weekly_projections pwp
            ON pwp.season = cr.season AND pwp.week = $3 AND pwp.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND cr.team_id = ANY($2::int[])
        """,
        season, team_ids, week,
    )
    by_team: dict[int, list] = {tid: [] for tid in team_ids}
    for r in rows:
        by_team[r["team_id"]].append(r)
    return {tid: _sort_roster_rows(team_rows) for tid, team_rows in by_team.items()}


# The single real source of truth for "this team's roster in week N" —
# live current_rosters for the season's actual current week (still
# editable — waivers/trades/lineup swaps must show up immediately, not
# a stale frozen snapshot), roster_history's real per-week snapshot for
# any passed week, falling back to the nearest earlier snapshot, and
# finally to live current_rosters if no snapshot exists yet at all
# (e.g. before the very first sync tick after this feature shipped).
# 2026-09: this is what fixes /teams/{id}/roster — see
# app/routers/league.py — from reading the wrong (ESPN's own,
# disconnected) league's roster for every week it shows.
async def get_roster_for_week(conn, season: int, team_id: int, week: int):
    current_week = await get_cached_current_week(conn, season)
    if current_week is not None and week == current_week:
        return await get_current_roster(conn, season, team_id, week)

    snapshot_week = await roster_history_queries.get_latest_snapshotted_week(conn, season, team_id, week)
    if snapshot_week is None:
        return await get_current_roster(conn, season, team_id, week)

    rows = await roster_history_queries.get_roster_history_for_week(conn, season, team_id, snapshot_week, week)
    return _sort_roster_rows(rows)


async def get_rosters_for_week(conn, season: int, team_ids: list[int], week: int) -> dict[int, list]:
    """Batched get_roster_for_week — a plain per-team loop rather than a
    new batched roster_history query. Unlike get_teams/get_current_rosters
    (a real, measured N+1 fix — see get_teams' own comment), this is
    called for a handful of teams in one matchup week at most, and each
    call is a single indexed range-scan, not the same cost shape."""
    if not team_ids:
        return {}
    return {tid: await get_roster_for_week(conn, season, tid, week) for tid in team_ids}


async def get_touchdowns_for_teams(conn, season: int, week: int, team_ids: list[int]) -> dict[int, list]:
    """Real "My Touchdowns" data for the matchup screen: each active
    (non-BE/IR) current_rosters player who scored a real touchdown this
    week, with how many. Same tds formula (pass_td + rush_td + rec_td)
    app/notifications/fantasy_events.py's snapshot_week already uses to
    detect a touchdown event — reused verbatim so a push notification
    and this screen can never disagree about what counts as one."""
    if not team_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT cr.team_id, p.full_name AS player_name, p.position,
               COALESCE((pws.raw_stats->>'pass_td')::float, 0)
             + COALESCE((pws.raw_stats->>'rush_td')::float, 0)
             + COALESCE((pws.raw_stats->>'rec_td')::float, 0) AS touchdowns
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN player_week_stats pws
            ON pws.season = cr.season AND pws.week = $2 AND pws.sleeper_player_id = cr.sleeper_player_id
            AND pws.league_id = cr.league_id
        WHERE cr.season = $1 AND cr.team_id = ANY($3::int[]) AND cr.lineup_slot NOT IN ('BE', 'IR')
        """,
        season, week, team_ids,
    )
    by_team: dict[int, list] = {tid: [] for tid in team_ids}
    for r in rows:
        if r["touchdowns"] > 0:
            by_team[r["team_id"]].append(
                {"player_name": r["player_name"], "position": r["position"], "touchdowns": int(r["touchdowns"])}
            )
    for tid, entries in by_team.items():
        entries.sort(key=lambda t: -t["touchdowns"])
    return by_team


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
            AND pws.league_id = cr.league_id
        WHERE cr.season = $1 AND p.pro_team = ANY($3::text[]) AND cr.league_id = $4
        """,
        season, week, pro_teams, league_id,
    )


async def get_top_scorers_by_pro_team(
    conn, season: int, week: int, pro_teams: list[str], league_id: int = DEFAULT_LEAGUE_ID, limit: int = 3
):
    """Gamecast's "Game Leaders" — the real top fantasy scorers on each
    of the two real NFL teams in a game, regardless of whether anyone
    in this league actually rosters them (unlike
    get_current_rostered_players_by_pro_team above, which is scoped to
    this league's own rosters on purpose). Matches ESPN's own Gamecast
    "Game Leaders" panel, which is a real-world-performance list, not a
    fantasy-ownership one."""
    if not pro_teams:
        return []
    return await conn.fetch(
        """
        SELECT player_id, player_name, position, pro_team, points_scored FROM (
            SELECT p.sleeper_player_id AS player_id, p.full_name AS player_name, p.position, p.pro_team,
                   pws.fantasy_points AS points_scored,
                   ROW_NUMBER() OVER (PARTITION BY p.pro_team ORDER BY pws.fantasy_points DESC) AS rn
            FROM player_week_stats pws
            JOIN players p ON p.sleeper_player_id = pws.sleeper_player_id
            WHERE pws.season = $1 AND pws.week = $2 AND p.pro_team = ANY($3::text[]) AND pws.league_id = $4
        ) ranked
        WHERE rn <= $5
        ORDER BY pro_team, rn
        """,
        season, week, pro_teams, league_id, limit,
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


async def get_rivalry_for_owners(conn, owner_a_id: int, owner_b_id: int, league_id: int = DEFAULT_LEAGUE_ID):
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
        WHERE ((r.owner_a_id = $1 AND r.owner_b_id = $2) OR (r.owner_a_id = $2 AND r.owner_b_id = $1))
          AND r.league_id = $3
        """,
        owner_a_id, owner_b_id, league_id,
    )


async def get_head_to_head(conn, owner_a_id: int, owner_b_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    """Ported from Fantasy_Helper's scripts/sync_rivalries.py
    compute_head_to_head, unchanged logic — but called live for ANY
    owner pair here, not just curated rivalries (that script only ever
    ran it for the names in rivalry_map.py and cached the result on the
    rivalries row). Same 0-0-means-unplayed exclusion as get_standings,
    plus the same 2026-09-09 is_week_final fix: a live, in-progress
    score is not 0-0, so that exclusion alone let a still-undecided
    current-week game show up as a real, colored "last 4" win/loss
    (real incident, Week 1 2026: the all-time head-to-head card marked
    a game green mid-kickoff). Only the *active* season's *current*
    week can possibly be live/undecided — every other row here already
    finished whenever it was actually played."""
    active = await conn.fetchrow("SELECT season, current_week FROM league_state ORDER BY season DESC LIMIT 1")
    exclude_season, exclude_week = None, None
    if active is not None and active["current_week"] is not None:
        current_games = await get_week_scoreboard(week=active["current_week"], year=active["season"])
        if not is_week_final(current_games):
            exclude_season, exclude_week = active["season"], active["current_week"]

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
          AND ($4::int IS NULL OR NOT (m.season = $4 AND m.week = $5))
        ORDER BY m.season, m.week
        """,
        owner_a_id, owner_b_id, league_id, exclude_season, exclude_week,
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


async def list_rivalries(conn, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT r.id, r.name, r.emoji, r.tagline, r.description, r.tier,
               r.all_time_wins_a, r.all_time_wins_b,
               oa.owner_id AS owner_a_id, oa.display_name AS owner_a_name,
               ob.owner_id AS owner_b_id, ob.display_name AS owner_b_name
        FROM rivalries r
        JOIN owners oa ON oa.owner_id = r.owner_a_id
        JOIN owners ob ON ob.owner_id = r.owner_b_id
        WHERE r.league_id = $1
        ORDER BY r.tier, r.name
        """,
        league_id,
    )
