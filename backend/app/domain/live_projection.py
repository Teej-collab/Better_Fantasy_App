"""
Live projections — ESPN-style in-game projections that move with the
game (2026-09-24, commissioner's request). Pure math, no DB or network:
callers pass in the scoreboard's game clock (app/providers/
nfl_scoreboard.py) and any in-game injury state (app/domain/
live_injuries.py).

    live projection = points so far + (rest of the game's projection)

- Before kickoff it's the pregame projection; once the game is final
  it's exactly the points scored.
- The rest of the game is projected at a blend of the pregame rate and
  the player's actual pace so far. Pace earns weight as the game goes
  on (PACE_MAX_WEIGHT at the final whistle) and is capped at
  PACE_CAP x the pregame projection, so one long early touchdown
  doesn't explode it.
- D/ST blends straight from projection to actual instead: its points-
  allowed/yards-allowed tiers start at 10 at kickoff and only fall as
  the opponent scores, so "points per minute so far" means nothing.
- An in-game injury scales whatever's left: ruled out -> nothing more,
  doubtful to return -> a quarter, left the game / questionable to
  return -> half, returned -> back to normal.

The stored pregame projection (player_weekly_projections,
weekly_team_stats.team_points_projected) is never changed by any of
this — every award that compares a score to "expected" (overachiever,
clutch/choke, boom/bust, season awards) keeps judging against the
pregame number.
"""

REGULATION_SECONDS = 60 * 60
QUARTER_SECONDS = 15 * 60

PACE_MAX_WEIGHT = 0.5
PACE_CAP = 3.0
# Pace ceiling for a player with no pregame projection at all.
NO_PROJECTION_PACE_CAP = 30.0

INJURY_REMAINING_FACTOR = {
    "returned": 1.0,
    "left": 0.5,
    "questionable_return": 0.5,
    "doubtful_return": 0.25,
    "ruled_out": 0.0,
}

_STATUS_BY_STATE = {"pre": "scheduled", "in": "in_progress", "post": "final"}


def share_of_game_left(state: str | None, period: int | None, clock: float | None) -> float:
    """1.0 before kickoff, 0.0 once final. Halftime reads 0.5 (ESPN
    reports it as period 2, clock 0). Overtime counts only its own
    clock, as a share of a regulation game."""
    if state == "post":
        return 0.0
    if state != "in":
        return 1.0
    period = period or 0
    clock = max(float(clock or 0), 0.0)
    if period <= 0:
        return 1.0
    if period <= 4:
        seconds_left = (4 - period) * QUARTER_SECONDS + min(clock, QUARTER_SECONDS)
    else:
        seconds_left = clock
    return min(max(seconds_left / REGULATION_SECONDS, 0.0), 1.0)


def game_clock_by_pro_team(games: list[dict]) -> dict[str, dict]:
    """pro_team -> {"status": "scheduled"|"in_progress"|"final",
    "share_left": 0..1} for every team on this week's scoreboard."""
    clock: dict[str, dict] = {}
    for g in games:
        status = _STATUS_BY_STATE.get(g.get("state"))
        if status is None:
            continue
        share = share_of_game_left(g.get("state"), g.get("period"), g.get("clock"))
        for team in (g.get("home_team"), g.get("away_team")):
            if team:
                clock[team] = {"status": status, "share_left": share}
    return clock


def live_projection(
    pregame: float | None,
    scored: float | None,
    position: str | None,
    game: dict | None,
    injury_state: str | None = None,
) -> float:
    pregame = float(pregame or 0)
    scored = float(scored or 0)
    status = (game or {}).get("status")

    if status == "final":
        return round(scored, 2)
    if status != "in_progress":
        return round(pregame, 2)

    share_left = (game or {}).get("share_left", 1.0)
    elapsed = 1.0 - share_left

    if position == "DEF":
        return round(elapsed * scored + share_left * pregame, 2)

    if elapsed > 0:
        cap = PACE_CAP * pregame if pregame > 0 else NO_PROJECTION_PACE_CAP
        pace = min(max(scored / elapsed, 0.0), cap)
    else:
        pace = pregame
    weight = PACE_MAX_WEIGHT * elapsed
    rest_of_game_rate = (1 - weight) * pregame + weight * pace

    factor = INJURY_REMAINING_FACTOR.get(injury_state, 1.0)
    return round(scored + share_left * rest_of_game_rate * factor, 2)


_NON_STARTER_SLOTS = ("BE", "IR")


def live_team_total(roster_rows, game_clock: dict[str, dict], injuries: dict[str, str] | None = None) -> float:
    """Sum of every starter's live projection. roster_rows use the
    roster queries' own keys (points_projected, points_scored,
    position, pro_team, player_id)."""
    injuries = injuries or {}
    total = 0.0
    for r in roster_rows:
        if r["lineup_slot"] in _NON_STARTER_SLOTS:
            continue
        total += live_projection(
            r["points_projected"], r["points_scored"], r["position"],
            game_clock.get(r["pro_team"]), injuries.get(r.get("player_id")),
        )
    return round(total, 2)
