"""
Everything a matchup view needs — the week-list expand-card (every
matchup in a week, batched to avoid a fetch storm) and the full
matchup detail page (one matchup, fetched directly) both render from
the same per-matchup shape, built by `_matchup_entry` below: each
team's record (existing standings query), hot/cold streak (batched —
see app/domain/streaks.py), real all-time head-to-head (any owner
pair, not just curated rivalries — see queries/league.py's
get_head_to_head), whether the matchup is a curated rivalry, whether
it's the week's Game of the Week (existing find_game_of_the_week,
unchanged), a live win-probability estimate once the matchup has
actually started (app/domain/win_probability.py — same "no meaningful
50/50 before kickoff" gate app/domain/your_week.py already uses), each
side's roster (with boom/bust flags) plus starters' combined projected
total, and — scoped to just these two teams, not the week's overall
winner — bench crime and clutch/choke status.

Ported from the shape of Fantasy_Helper's bot/discord_bot/embeds/
preview_embed.py (build_preview_embed / build_matchup_detail_embed),
which already assembled exactly this same set of facts per matchup for
the Discord /preview command — just returning structured data here
instead of building a Discord embed, and computing head-to-head live
for every matchup instead of only the ones with a curated rivalry
entry.

`narrative` is filled in by app/domain/narrative_engine.py — real
generated text once ANTHROPIC_API_KEY is configured and the matchup is
in an eligible state, null otherwise (no key set, or nothing eligible
yet — see that module for exactly when "preview" vs "recap" applies).
build_week_matchup_context only ever reads the cache (never triggers a
live generation — see narrative_engine.get_cached_narrative's own
docstring for why); build_matchup_detail is the one path allowed to
actually generate.
"""
import asyncio
import json

from app.config import DEFAULT_LEAGUE_ID
from app.db import get_pool
from app.domain import narrative_engine
from app.domain.live_injuries import get_injury_states
from app.domain.live_projection import game_clock_by_pro_team, live_projection, live_team_total
from app.domain.nfl_schedule import (
    game_status_by_pro_team,
    live_status_by_pro_team,
    locked_pro_teams,
    schedule_lookup_by_pro_team,
)
from app.domain.streaks import get_team_streaks
from app.domain.team_profile import find_game_of_the_week
from app.domain.weekly_awards import get_clutch_choke_status_by_team
from app.domain.win_probability import estimate_win_probability
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.queries import league as queries
from app.queries import team_position_rankings as position_rankings_queries
from app.queries.power_rankings import get_latest_power_rank_by_team

# Defense-vs-position matchup rank only applies to these positions — see
# migration 465f0b1ffe3f for why D/ST is deliberately excluded.
_POSITION_RANK_ELIGIBLE = {"QB", "RB", "WR", "TE", "K"}

_STARTER_EXCLUDED_SLOTS = {"BE", "IR"}


def _projected_total(roster_rows) -> float | None:
    starters = [r for r in roster_rows if r["lineup_slot"] not in _STARTER_EXCLUDED_SLOTS]
    if not starters:
        return None
    return round(sum(float(r["points_projected"] or 0) for r in starters), 2)


# Win probability runs off live projections (app/domain/
# live_projection.py): each starter's points so far plus a pace- and
# injury-aware projection for the rest of their game. That replaced a
# per-player max(points, projection) stopgap (2026-09-10) that never let
# a slow game — or, before 2026-09-24, even a finished dud — lower a
# team's odds.


def _roster_list(
    roster_rows, schedule_by_pro_team, live_status_by_pro_team_map, rankings=None, game_status_by_pro_team_map=None,
    game_clock=None, injuries=None,
):
    rankings = rankings or {}
    game_status_by_pro_team_map = game_status_by_pro_team_map or {}
    game_clock = game_clock or {}
    injuries = injuries or {}
    result = []
    for r in roster_rows:
        info = schedule_by_pro_team.get(r["pro_team"], {})
        live_info = live_status_by_pro_team_map.get(r["pro_team"], {})
        opponent_pro_team = info.get("opponent_pro_team")
        injury = injuries.get(r["player_id"])
        opponent_position_rank = None
        if opponent_pro_team and r["position"] in _POSITION_RANK_ELIGIBLE:
            opponent_position_rank = rankings.get((opponent_pro_team, r["position"]))
        result.append(
            {
                "player_name": r["player_name"],
                "position": r["position"],
                "lineup_slot": r["lineup_slot"],
                "points_scored": float(r["points_scored"]) if r["points_scored"] is not None else None,
                # Pregame projection — never changes during the game.
                "points_projected": float(r["points_projected"]) if r["points_projected"] is not None else None,
                # Moves with the game: points so far + pace- and
                # injury-aware rest-of-game projection. Equals the
                # pregame number before kickoff and the real points once
                # the game is final (app/domain/live_projection.py).
                "live_projected": live_projection(
                    r["points_projected"], r["points_scored"], r["position"],
                    game_clock.get(r["pro_team"]), injury["state"] if injury else None,
                ),
                # {"state": "left"|"returned"|"questionable_return"|
                # "doubtful_return"|"ruled_out", "detail"} or null.
                "in_game_injury": injury,
                # Raw per-category stat counts (rec/rec_yd/pass_td/...,
                # see app/domain/scoring_engine.py) behind this week's
                # points_scored — asyncpg returns jsonb as text (no
                # codec registered), so this decodes it into a real
                # object rather than a JSON-string-inside-JSON.
                "raw_stats": json.loads(r["raw_stats"]) if r.get("raw_stats") else None,
                "player_id": r["player_id"],
                "pro_team": r["pro_team"],
                "injury_status": r["injury_status"],
                # Both null pre-season (no cached current week yet) or
                # if a real scoreboard fetch fails — see the two
                # build_* callers below, same "never break the page over
                # this" discipline app/routers/me.py's GET /team uses.
                "next_opponent": info.get("next_opponent"),
                "game_time": info.get("game_time"),
                "opponent_position_rank": opponent_position_rank,
                "is_boom": bool(r["is_boom"]),
                "is_bust": bool(r["is_bust"]),
                # Same live-status cross-reference My Team's GET /team
                # already applies (app/domain/nfl_schedule.py's
                # live_status_by_pro_team) — only ever true during a
                # real in-progress game for this player's own pro_team,
                # for either roster (home or away), not just "my team."
                "on_offense": live_info.get("on_offense", False),
                "is_redzone": live_info.get("is_redzone", False),
                # "scheduled" | "in_progress" | "final" | null (no real
                # scoreboard data this week) — the matchup screen's own
                # grey/white/grey-with-white-score text treatment reads
                # off this directly (see game_status_by_pro_team's own
                # docstring).
                "game_status": game_status_by_pro_team_map.get(r["pro_team"]),
            }
        )
    return result


def _side_dict(
    team_row, score, standings_row, streak, roster_rows, bench_crimes, clutch_choke, win_probability,
    schedule_by_pro_team, touchdowns, live_status_by_pro_team_map, rankings=None, power_rank=None,
    game_status_by_pro_team_map=None, game_clock=None, injuries=None,
):
    return {
        "team_id": team_row["team_id"],
        "team_name": team_row["team_name"],
        "owner_id": team_row["owner_id"],
        "owner_name": team_row["owner_name"],
        "logo_url": team_row["logo_url"],
        # This team's own current power rank (app/domain/
        # weekly_team_stats.py's compute_power_ranks_for_week) — the
        # same Standings-style #N badge, now everywhere a team name
        # shows. Null until that team has at least one ranked week.
        "power_rank": power_rank,
        "score": float(score) if score is not None else None,
        # Real season-to-date total (standings' own points_for) — the
        # "season total" beneath the live score, distinct from
        # projected_total (this week's starters-only projection).
        "season_points": float(standings_row["points_for"]) if standings_row else None,
        "record": (
            f"{standings_row['wins']}-{standings_row['losses']}"
            + (f"-{standings_row['ties']}" if standings_row["ties"] else "")
            if standings_row
            else None
        ),
        "streak": streak,
        # Live team projection (sum of starters' live_projected) — the
        # number that moves during games; pregame_projected_total is the
        # fixed pregame sum.
        "projected_total": live_team_total(roster_rows, game_clock or {}, _injury_state_map(injuries)),
        "pregame_projected_total": _projected_total(roster_rows),
        "roster": _roster_list(
            roster_rows, schedule_by_pro_team, live_status_by_pro_team_map, rankings, game_status_by_pro_team_map,
            game_clock, injuries,
        ),
        # Real touchdowns scored by this team's active starters this
        # week (see queries.get_touchdowns_for_teams) — empty before
        # any games have been played, same honest-zero as everything
        # else on this page pre-kickoff.
        "touchdowns": touchdowns,
        # Worst crime first (bench_crimes rows already come back ordered
        # by points_diff DESC) — a team can have zero, one, or several;
        # the badge only ever shows the headline one.
        "bench_crime": bench_crimes[0] if bench_crimes else None,
        "clutch_choke": clutch_choke,
        "win_probability": win_probability,
    }


def _injury_state_map(injuries) -> dict[str, str]:
    return {pid: v["state"] for pid, v in (injuries or {}).items()}


def _rivalry_dict(rivalry_row, home_owner_id):
    is_home_a = rivalry_row["owner_a_id"] == home_owner_id
    return {
        "name": rivalry_row["name"],
        "emoji": rivalry_row["emoji"],
        "tagline": rivalry_row["tagline"],
        "description": rivalry_row["description"],
        "tier": rivalry_row["tier"],
        "all_time_wins_home": rivalry_row["all_time_wins_a"] if is_home_a else rivalry_row["all_time_wins_b"],
        "all_time_wins_away": rivalry_row["all_time_wins_b"] if is_home_a else rivalry_row["all_time_wins_a"],
    }


def _matchup_entry(
    m, season, week, league_id, home_team, away_team, home_roster, away_roster,
    home_standing, away_standing, home_streak, away_streak,
    rivalry, h2h, is_gow, score_stdev,
    home_bench_crimes, away_bench_crimes, home_clutch_choke, away_clutch_choke,
    narrative, schedule_by_pro_team, home_touchdowns, away_touchdowns,
    locked_teams=frozenset(), live_status_by_pro_team_map=None, rankings=None,
    power_rank_by_team=None, game_status_by_pro_team_map=None, game_clock=None, injuries=None,
):
    """Pure assembly — every argument is already-fetched data, no DB
    access here. Shared by build_week_matchup_context (which batches
    these fetches once for the whole week) and build_matchup_detail
    (which fetches them for just the one matchup), so the week-list
    card and the full detail page can never quietly drift apart."""
    live_status_by_pro_team_map = live_status_by_pro_team_map or {}
    power_rank_by_team = power_rank_by_team or {}
    home_score, away_score = m["home_score"], m["away_score"]
    started = home_score is not None and away_score is not None and not (home_score == 0 and away_score == 0)

    home_win_probability = None
    away_win_probability = None
    if started:
        injury_states = _injury_state_map(injuries)
        home_win_probability = estimate_win_probability(
            float(home_score), live_team_total(home_roster, game_clock or {}, injury_states),
            float(away_score), live_team_total(away_roster, game_clock or {}, injury_states),
            score_stdev,
        )
        away_win_probability = round(100 - home_win_probability, 1)

    return {
        "matchup_id": m["matchup_id"],
        "season": season,
        "week": week,
        # Added for narrative_engine.py — career badges, chug standing,
        # and league rank are all per-league lookups, and this dict is
        # the only thing get_or_generate_narrative receives (no raw
        # matchup row to re-derive it from).
        "league_id": league_id,
        "is_playoff": m["is_playoff"],
        "is_game_of_the_week": is_gow,
        "is_rivalry": rivalry is not None,
        "rivalry": _rivalry_dict(rivalry, home_team["owner_id"]) if rivalry else None,
        "head_to_head": {
            # get_head_to_head was called with home's owner_id as
            # owner_a_id, so wins_a/"a" is always home's side here.
            "wins_home": h2h["wins_a"],
            "wins_away": h2h["wins_b"],
            "ties": h2h["ties"],
            "last_season": h2h["last_season"],
            "last_week": h2h["last_week"],
            "recent_meetings": [
                {
                    "season": g["season"],
                    "week": g["week"],
                    "home_won": g["winner"] == "a",
                    "tie": g["winner"] == "tie",
                    "home_score": g["a_score"],
                    "away_score": g["b_score"],
                }
                for g in h2h["recent_games"]
            ],
        },
        "home": _side_dict(
            home_team, home_score, home_standing, home_streak, home_roster,
            home_bench_crimes, home_clutch_choke, home_win_probability,
            schedule_by_pro_team, home_touchdowns, live_status_by_pro_team_map, rankings,
            power_rank_by_team.get(home_team["team_id"]), game_status_by_pro_team_map, game_clock, injuries,
        ),
        "away": _side_dict(
            away_team, away_score, away_standing, away_streak, away_roster,
            away_bench_crimes, away_clutch_choke, away_win_probability,
            schedule_by_pro_team, away_touchdowns, live_status_by_pro_team_map, rankings,
            power_rank_by_team.get(away_team["team_id"]), game_status_by_pro_team_map, game_clock, injuries,
        ),
        "narrative": narrative,
    }


async def build_week_matchup_context(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    matchups = [dict(m) for m in await queries.list_week_matchups(conn, season, week, league_id)]
    if not matchups:
        return {"season": season, "week": week, "game_of_the_week_matchup_id": None, "matchups": []}

    team_ids = list({m["home_team_id"] for m in matchups} | {m["away_team_id"] for m in matchups})
    standings_by_team = {r["team_id"]: r for r in await queries.get_standings(conn, season, league_id)}
    power_rank_by_team = await get_latest_power_rank_by_team(conn, season, team_ids, league_id)
    streaks_by_team = await get_team_streaks(conn, season, team_ids)
    score_stdev = await queries.get_team_score_stdev(conn, season, league_id)
    bench_crimes_by_team = await queries.get_bench_crimes_by_team(conn, season, week, team_ids, league_id)
    clutch_choke_by_team = await get_clutch_choke_status_by_team(conn, season, week, league_id)
    touchdowns_by_team = await queries.get_touchdowns_for_teams(conn, season, week, team_ids)

    # One real scoreboard fetch for the whole week — every matchup's
    # roster rows share the same schedule, cross-referenced by pro_team
    # (see app/domain/nfl_schedule.py). A fetch failure shouldn't break
    # the whole week's matchup list, same discipline as GET /team.
    try:
        games = await get_week_scoreboard(week, season)
    except Exception:
        games = []
    schedule_by_pro_team = schedule_lookup_by_pro_team(games)
    locked_teams = locked_pro_teams(games)
    # Same "defense vs. position" matchup rank GET /team already
    # surfaces (app/routers/me.py) — one bulk fetch for the whole
    # week's matchups, joined per-player by (opponent pro_team,
    # position) inside _roster_list.
    rankings = await position_rankings_queries.get_rankings(conn, season, week)
    # Reuses this same `games` scoreboard fetch — no extra network
    # call. live_status_by_pro_team naturally returns nothing for any
    # team without a real in-progress game right now, safe to compute
    # for every week, live or not. Deliberately NOT
    # app.gamecast.service's own cache (see that function's own
    # docstring for why it was — 2026-09-13 fix).
    live_status_map = live_status_by_pro_team(games)
    game_status_map = game_status_by_pro_team(games)
    game_clock = game_clock_by_pro_team(games)

    gow = await find_game_of_the_week(conn, season, week, matchups)
    gow_id = None
    if gow:
        for m in matchups:
            if m["home_team_id"] == gow["home_team_id"] and m["away_team_id"] == gow["away_team_id"]:
                gow_id = m["matchup_id"]
                break

    # Batched instead of a get_team + get_roster call per matchup, and
    # list_rivalries (already a single, unfiltered fetch — see this
    # module's own get_rivalry_for_owners callers elsewhere) instead of
    # a get_rivalry_for_owners call per matchup — the real fix for the
    # 2026-09-02 SSR-performance finding: this endpoint alone measured
    # 3.36s for a 6-matchup week, almost entirely spent on ~40 small
    # sequential round-trips to the same handful of tables inside what
    # used to be a plain `for m in matchups:` loop.
    teams_by_id = await queries.get_teams(conn, team_ids)
    rosters_by_id = await queries.get_rosters_for_week(conn, season, team_ids, week)
    injuries = await get_injury_states(
        conn, season, week, [r["player_id"] for roster in rosters_by_id.values() for r in roster]
    )
    rivalry_by_pair = {
        frozenset({r["owner_a_id"], r["owner_b_id"]}): r for r in await queries.list_rivalries(conn)
    }

    # head-to-head and the narrative cache read are the two remaining
    # per-matchup DB calls — genuinely per-pair/per-matchup, not
    # batchable into one query the same way teams/rosters/rivalries
    # are above. Each matchup gets its own short-lived pooled
    # connection and all matchups are assembled concurrently instead
    # of queued one after another on the single connection this
    # function was called with — a handful of brief extra connections
    # (bounded by how many matchups are in a week, typically well under
    # ten) rather than one held connection doing everything serially.
    pool = await get_pool()

    async def process(m):
        home_team = teams_by_id[m["home_team_id"]]
        away_team = teams_by_id[m["away_team_id"]]
        home_roster = rosters_by_id.get(m["home_team_id"], [])
        away_roster = rosters_by_id.get(m["away_team_id"], [])
        rivalry = rivalry_by_pair.get(frozenset({home_team["owner_id"], away_team["owner_id"]}))

        async with pool.acquire() as c:
            h2h = await queries.get_head_to_head(c, home_team["owner_id"], away_team["owner_id"], league_id)

        entry = _matchup_entry(
            m, season, week, league_id, home_team, away_team, home_roster, away_roster,
            standings_by_team.get(m["home_team_id"]), standings_by_team.get(m["away_team_id"]),
            streaks_by_team.get(m["home_team_id"], "neutral"), streaks_by_team.get(m["away_team_id"], "neutral"),
            rivalry, h2h, m["matchup_id"] == gow_id, score_stdev,
            bench_crimes_by_team.get(m["home_team_id"], []), bench_crimes_by_team.get(m["away_team_id"], []),
            clutch_choke_by_team.get(m["home_team_id"]), clutch_choke_by_team.get(m["away_team_id"]),
            None, schedule_by_pro_team,
            touchdowns_by_team.get(m["home_team_id"], []), touchdowns_by_team.get(m["away_team_id"], []),
            locked_teams, live_status_map, rankings, power_rank_by_team, game_status_map,
            game_clock, injuries,
        )
        # Cache read only — never triggers a live generation here. See
        # narrative_engine.get_cached_narrative's own docstring for why
        # (up to ~7 sequential Claude calls on one page load otherwise).
        async with pool.acquire() as c:
            entry["narrative"] = await narrative_engine.get_cached_narrative(c, entry)
        return entry

    results = await asyncio.gather(*(process(m) for m in matchups))

    return {"season": season, "week": week, "game_of_the_week_matchup_id": gow_id, "matchups": list(results)}


async def build_matchup_detail(conn, matchup_id: int) -> dict | None:
    """Same per-matchup shape build_week_matchup_context returns for
    one entry in its list, fetched directly for a single matchup_id
    instead of batched across a whole week — powers GET /matchups/{id}
    (the full matchup detail page, a public permalink per routers/
    league.py's own module docstring — reachable regardless of the
    visitor's own active league). Deliberately doesn't try to reuse the
    week-level batched queries (that batching exists specifically to
    avoid an N-matchup fetch storm; for exactly one matchup there's no
    storm to avoid, so fetching get_standings/get_team_streaks/etc.
    scoped to just this matchup's two teams is simpler and just as
    cheap here).

    league_id is deliberately read from the matchup row itself
    (m["league_id"]), never from the caller's session/active league —
    a permalink to a matchup in League #2 must resolve League #2's own
    standings/streaks/etc., not whatever league the visitor currently
    has active."""
    m = await queries.get_matchup(conn, matchup_id)
    if m is None:
        return None
    m = dict(m)
    season, week, league_id = m["season"], m["week"], m["league_id"]

    home_team = await queries.get_team(conn, m["home_team_id"])
    away_team = await queries.get_team(conn, m["away_team_id"])
    home_roster = await queries.get_roster_for_week(conn, season, m["home_team_id"], week)
    away_roster = await queries.get_roster_for_week(conn, season, m["away_team_id"], week)

    team_ids = [m["home_team_id"], m["away_team_id"]]
    standings_by_team = {r["team_id"]: r for r in await queries.get_standings(conn, season, league_id)}
    power_rank_by_team = await get_latest_power_rank_by_team(conn, season, team_ids, league_id)
    streaks_by_team = await get_team_streaks(conn, season, team_ids)
    score_stdev = await queries.get_team_score_stdev(conn, season, league_id)
    bench_crimes_by_team = await queries.get_bench_crimes_by_team(conn, season, week, team_ids, league_id)
    clutch_choke_by_team = await get_clutch_choke_status_by_team(conn, season, week, league_id)
    touchdowns_by_team = await queries.get_touchdowns_for_teams(conn, season, week, team_ids)

    try:
        games = await get_week_scoreboard(week, season)
    except Exception:
        games = []
    schedule_by_pro_team = schedule_lookup_by_pro_team(games)
    locked_teams = locked_pro_teams(games)
    live_status_map = live_status_by_pro_team(games)
    game_status_map = game_status_by_pro_team(games)
    game_clock = game_clock_by_pro_team(games)
    rankings = await position_rankings_queries.get_rankings(conn, season, week)
    injuries = await get_injury_states(conn, season, week, [r["player_id"] for r in home_roster + away_roster])

    rivalry = await queries.get_rivalry_for_owners(conn, home_team["owner_id"], away_team["owner_id"], league_id)
    h2h = await queries.get_head_to_head(conn, home_team["owner_id"], away_team["owner_id"], league_id)

    week_matchups = [dict(r) for r in await queries.list_week_matchups(conn, season, week, league_id)]
    gow = await find_game_of_the_week(conn, season, week, week_matchups)
    is_gow = bool(gow and gow["home_team_id"] == m["home_team_id"] and gow["away_team_id"] == m["away_team_id"])

    entry = _matchup_entry(
        m, season, week, league_id, home_team, away_team, home_roster, away_roster,
        standings_by_team.get(m["home_team_id"]), standings_by_team.get(m["away_team_id"]),
        streaks_by_team.get(m["home_team_id"], "neutral"), streaks_by_team.get(m["away_team_id"], "neutral"),
        rivalry, h2h, is_gow, score_stdev,
        bench_crimes_by_team.get(m["home_team_id"], []), bench_crimes_by_team.get(m["away_team_id"], []),
        clutch_choke_by_team.get(m["home_team_id"]), clutch_choke_by_team.get(m["away_team_id"]),
        None, schedule_by_pro_team,
        touchdowns_by_team.get(m["home_team_id"], []), touchdowns_by_team.get(m["away_team_id"], []),
        locked_teams, live_status_map, rankings, power_rank_by_team, game_status_map,
        game_clock, injuries,
    )
    # The one path allowed to actually trigger a live generation — a
    # single matchup per request, a bounded cost. See narrative_engine.
    # get_or_generate_narrative's own docstring.
    entry["narrative"] = await narrative_engine.get_or_generate_narrative(conn, entry)
    return entry
