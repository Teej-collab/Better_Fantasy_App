"""
"Your Week" — the logged-in homepage hero. One owner's current-week
matchup: opponent, scores, starters' projected totals, record, and a
win-probability estimate (see win_probability.py).

Win probability specifically is gated to only compute once the matchup
has actually started (real, non-zero scores) — a meaningless 50/50
before kickoff isn't worth showing, matching the explicit product call
that it "won't show anything until the season starts and has live
information feeding over."

`season` is passed in by the caller (app/routers/me.py, from
ACTIVE_SEASON) rather than inferred from `MAX(teams_by_season.season)`
here — that would happen to equal the active season in practice, but
only by coincidence, and it's untestable (a synthetic test season is
never the real global max). ACTIVE_SEASON is already the one
authoritative "what season is it right now" value the rest of the app
uses (app/providers/espn/config.py).
"""
from app.domain.win_probability import estimate_win_probability
from app.queries import league as queries

_STARTER_EXCLUDED_SLOTS = {"BE", "IR"}


def _projected_total(roster_rows) -> float:
    starters = [r for r in roster_rows if r["lineup_slot"] not in _STARTER_EXCLUDED_SLOTS]
    return round(sum(float(r["points_projected"] or 0) for r in starters), 2)


async def build_your_week(conn, owner_id: int, season: int):
    team = await conn.fetchrow(
        "SELECT id AS team_id, team_name FROM teams_by_season WHERE season = $1 AND owner_id = $2",
        season, owner_id,
    )
    if team is None:
        return None  # this owner has no team in the latest season (e.g. left the league)

    # Real, current state right now (preseason, pre-draft): draft is
    # cheap (one row, may not exist yet) and always attached regardless
    # of week, not just in the no-matchup branch below, so the response
    # shape stays consistent whether or not a matchup exists.
    draft_row = await conn.fetchrow(
        "SELECT scheduled_start, status FROM draft_config WHERE season = $1", season
    )
    draft = (
        {"scheduled_start": draft_row["scheduled_start"], "status": draft_row["status"]}
        if draft_row is not None
        else None
    )

    week = await queries.get_cached_current_week(conn, season)
    base = {
        "season": season, "week": week, "team_id": team["team_id"], "team_name": team["team_name"],
        "matchup": None, "draft": draft,
    }
    if not week or week < 1:
        return base  # preseason — no real current week yet

    matchup = await queries.get_matchup_for_team(conn, team["team_id"], season, week)
    if matchup is None:
        return base  # e.g. a bye week

    is_home = matchup["home_team_id"] == team["team_id"]
    my_score = matchup["home_score"] if is_home else matchup["away_score"]
    opp_score = matchup["away_score"] if is_home else matchup["home_score"]
    opp_team_id = matchup["away_team_id"] if is_home else matchup["home_team_id"]
    opp_team_name = matchup["away_team_name"] if is_home else matchup["home_team_name"]

    started = my_score is not None and opp_score is not None and not (my_score == 0 and opp_score == 0)

    my_roster = await queries.get_roster(conn, team["team_id"], week)
    opp_roster = await queries.get_roster(conn, opp_team_id, week)
    my_projected = _projected_total(my_roster)
    opp_projected = _projected_total(opp_roster)

    standings_by_team = {r["team_id"]: r for r in await queries.get_standings(conn, season)}
    my_standing = standings_by_team.get(team["team_id"])
    record = None
    if my_standing:
        record = f"{my_standing['wins']}-{my_standing['losses']}"
        if my_standing["ties"]:
            record += f"-{my_standing['ties']}"

    win_probability = None
    if started:
        stdev = await queries.get_team_score_stdev(conn, season)
        win_probability = estimate_win_probability(
            float(my_score), my_projected, float(opp_score), opp_projected, stdev
        )

    base["matchup"] = {
        "matchup_id": matchup["matchup_id"],
        "is_playoff": matchup["is_playoff"],
        "started": started,
        "record": record,
        "my_score": float(my_score) if my_score is not None else None,
        "my_projected_total": my_projected,
        "opponent_team_id": opp_team_id,
        "opponent_team_name": opp_team_name,
        "opponent_score": float(opp_score) if opp_score is not None else None,
        "opponent_projected_total": opp_projected,
        "win_probability": win_probability,
    }
    return base
