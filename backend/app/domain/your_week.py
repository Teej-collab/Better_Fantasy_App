"""
"Your Week" — the logged-in homepage hero. One owner's current-week
matchup: opponent, scores, starters' projected totals, record, and a
win-probability estimate (see win_probability.py).

Win probability is always computed (2026-09-25 ask) — before kickoff
the scores are 0 and it runs purely off the two teams' projections.

`season` is passed in by the caller (app/routers/me.py, from
ACTIVE_SEASON) rather than inferred from `MAX(teams_by_season.season)`
here — that would happen to equal the active season in practice, but
only by coincidence, and it's untestable (a synthetic test season is
never the real global max). ACTIVE_SEASON is already the one
authoritative "what season is it right now" value the rest of the app
uses (app/providers/espn/config.py).
"""
import asyncio

from app.config import DEFAULT_LEAGUE_ID
from app.db import on_own_conn
from app.domain.live_injuries import get_injury_states
from app.domain.live_projection import game_clock_by_pro_team, live_team_total, remaining_share
from app.domain.streaks import get_result_streaks
from app.domain.win_probability import estimate_win_probability
from app.providers.nfl_scoreboard import get_week_scoreboard, is_week_final
from app.queries import draft as draft_queries
from app.queries import league as queries
from app.queries.power_rankings import get_latest_power_rank_by_team

_STARTER_EXCLUDED_SLOTS = {"BE", "IR", "TAXI"}


def _projected_total(roster_rows) -> float:
    starters = [r for r in roster_rows if r["lineup_slot"] not in _STARTER_EXCLUDED_SLOTS]
    return round(sum(float(r["points_projected"] or 0) for r in starters), 2)


def _starter_game_counts(roster_rows, game_clock) -> tuple[int, int]:
    """(yet to play, in play) among this week's starters, off the same
    scoreboard game clock the live projections use. A starter on bye
    (no game this week) counts toward neither."""
    yet_to_play = in_play = 0
    for r in roster_rows:
        if r["lineup_slot"] in _STARTER_EXCLUDED_SLOTS:
            continue
        status = (game_clock.get(r["pro_team"]) or {}).get("status")
        if status == "scheduled":
            yet_to_play += 1
        elif status == "in_progress":
            in_play += 1
    return yet_to_play, in_play


def _record(standing) -> str | None:
    if not standing:
        return None
    record = f"{standing['wins']}-{standing['losses']}"
    if standing["ties"]:
        record += f"-{standing['ties']}"
    return record


async def _week_scoreboard_or_empty(week: int, season: int) -> list[dict]:
    # Live projections (app/domain/live_projection.py) move during
    # games; a fetch failure just means pregame projections.
    try:
        return await get_week_scoreboard(week, season)
    except Exception:
        return []


async def _none():
    return None


async def build_your_week(conn, owner_id: int, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    # Reads run in four parallel rounds, each only waiting on what it
    # needs from the one before — see app/db.py's on_own_conn. This used
    # to be ~14 sequential round trips (~0.8 s per home page load).
    #
    # Round 1: nothing depends on anything yet. The draft is cheap (one
    # row, may not exist yet) and always attached regardless of week, so
    # the response shape stays consistent whether or not a matchup
    # exists. The pre-set schedule is only used when there's no
    # draft_config row: a commissioner may have set just the date ahead
    # of deciding the order (PUT /draft/schedule, held in
    # league_draft_schedule — see that table's own migration docstring).
    team, draft_row, pre_set, week = await asyncio.gather(
        on_own_conn(
            lambda c: c.fetchrow(
                "SELECT id AS team_id, team_name FROM teams_by_season"
                " WHERE season = $1 AND owner_id = $2 AND league_id = $3",
                season, owner_id, league_id,
            )
        ),
        on_own_conn(
            lambda c: c.fetchrow(
                "SELECT scheduled_start, status FROM draft_config WHERE season = $1 AND league_id = $2",
                season, league_id,
            )
        ),
        on_own_conn(draft_queries.get_schedule_only, season, league_id),
        on_own_conn(queries.get_cached_current_week, season),
    )
    if team is None:
        return None  # this owner has no team in the latest season (e.g. left the league)

    if draft_row is not None:
        draft = {"scheduled_start": draft_row["scheduled_start"], "status": draft_row["status"]}
    else:
        # "not_started" is the only real status this can ever be
        # without a draft_config row to say otherwise.
        draft = {"scheduled_start": pre_set, "status": "not_started"} if pre_set is not None else None

    # Round 2: this team's own power rank (Standings-style #N badge —
    # 2026-09-17: now also the Your Week hero, matchup header, and
    # Other Matchups list; null until this team has a ranked week), plus
    # everything the matchup needs that only depends on the week. On a
    # bye week the standings/stdev/scoreboard reads are wasted, which is
    # cheaper than waiting for the matchup before starting them.
    has_week = bool(week) and week >= 1
    power_rank_by_team, matchup, standings_rows, stdev, games = await asyncio.gather(
        on_own_conn(get_latest_power_rank_by_team, season, [team["team_id"]], league_id),
        on_own_conn(queries.get_matchup_for_team, team["team_id"], season, week, league_id) if has_week else _none(),
        on_own_conn(queries.get_standings, season, league_id) if has_week else _none(),
        on_own_conn(queries.get_team_score_stdev, season, league_id) if has_week else _none(),
        _week_scoreboard_or_empty(week, season) if has_week else _none(),
    )
    base = {
        "season": season, "week": week, "team_id": team["team_id"], "team_name": team["team_name"],
        "power_rank": power_rank_by_team.get(team["team_id"]),
        "matchup": None, "draft": draft,
    }
    if not has_week:
        return base  # preseason — no real current week yet

    if matchup is None:
        return base  # e.g. a bye week

    is_home = matchup["home_team_id"] == team["team_id"]
    my_score = matchup["home_score"] if is_home else matchup["away_score"]
    opp_score = matchup["away_score"] if is_home else matchup["home_score"]
    opp_team_id = matchup["away_team_id"] if is_home else matchup["home_team_id"]
    opp_team_name = matchup["away_team_name"] if is_home else matchup["home_team_name"]

    started = my_score is not None and opp_score is not None and not (my_score == 0 and opp_score == 0)

    # Round 3: everything that needs the opponent.
    pair = [team["team_id"], opp_team_id]
    power_rank_by_team, my_roster, opp_roster, result_streaks, teams_by_id = await asyncio.gather(
        on_own_conn(get_latest_power_rank_by_team, season, pair, league_id),
        on_own_conn(queries.get_current_roster, season, team["team_id"], week),
        on_own_conn(queries.get_current_roster, season, opp_team_id, week),
        on_own_conn(
            get_result_streaks, season, pair, week, exclude_week=None if is_week_final(games) else week
        ),
        on_own_conn(queries.get_teams, pair),
    )
    base["power_rank"] = power_rank_by_team.get(team["team_id"])

    # Round 4: needs the rosters. Live projections equal the pregame
    # projection before kickoff.
    game_clock = game_clock_by_pro_team(games)
    injury_rows = await get_injury_states(conn, season, week, [r["player_id"] for r in my_roster + opp_roster])
    injuries = {pid: v["state"] for pid, v in injury_rows.items()}
    my_pregame = _projected_total(my_roster)
    opp_pregame = _projected_total(opp_roster)
    my_projected = live_team_total(my_roster, game_clock, injuries) if my_roster else my_pregame
    opp_projected = live_team_total(opp_roster, game_clock, injuries) if opp_roster else opp_pregame

    standings_by_team = {r["team_id"]: r for r in standings_rows}
    record = _record(standings_by_team.get(team["team_id"]))
    opp_record = _record(standings_by_team.get(opp_team_id))
    my_team_row, opp_team_row = teams_by_id.get(team["team_id"]), teams_by_id.get(opp_team_id)
    my_yet_to_play, my_in_play = _starter_game_counts(my_roster, game_clock)
    opp_yet_to_play, opp_in_play = _starter_game_counts(opp_roster, game_clock)

    # Same live projections as the matchup page, so the two can never
    # show different odds for one game.
    win_probability = estimate_win_probability(
        float(my_score or 0), my_projected,
        float(opp_score or 0), opp_projected,
        stdev,
        remaining_share(my_roster, game_clock, injuries) if my_roster else 1.0,
        remaining_share(opp_roster, game_clock, injuries) if opp_roster else 1.0,
    )

    base["matchup"] = {
        "matchup_id": matchup["matchup_id"],
        "is_playoff": matchup["is_playoff"],
        "started": started,
        "record": record,
        "my_owner_name": my_team_row["owner_name"] if my_team_row else None,
        "my_logo_url": my_team_row["logo_url"] if my_team_row else None,
        "my_result_streak": result_streaks.get(team["team_id"]),
        "my_yet_to_play": my_yet_to_play,
        "my_in_play": my_in_play,
        "my_score": float(my_score) if my_score is not None else None,
        "my_projected_total": my_projected,
        "my_pregame_projected_total": my_pregame,
        "opponent_team_id": opp_team_id,
        "opponent_team_name": opp_team_name,
        "opponent_power_rank": power_rank_by_team.get(opp_team_id),
        "opponent_owner_name": opp_team_row["owner_name"] if opp_team_row else None,
        "opponent_logo_url": opp_team_row["logo_url"] if opp_team_row else None,
        "opponent_record": opp_record,
        "opponent_result_streak": result_streaks.get(opp_team_id),
        "opponent_yet_to_play": opp_yet_to_play,
        "opponent_in_play": opp_in_play,
        "opponent_score": float(opp_score) if opp_score is not None else None,
        "opponent_projected_total": opp_projected,
        "opponent_pregame_projected_total": opp_pregame,
        "win_probability": win_probability,
    }
    return base
