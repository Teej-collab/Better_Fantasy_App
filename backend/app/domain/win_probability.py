"""
Win probability for a live (or about-to-start) matchup.

Confirmed directly against ESPN's raw API (mLiveScoring/mScoreboard/
mMatchupScore/mBoxscore views, checked against both a completed season
and the current preseason) that ESPN does NOT expose a computed win
probability anywhere — no such field exists in their fantasy data. So
this is our own estimate, built from real ESPN-sourced inputs (current
score, each team's real season-long projected total from synced roster
data) plus the league's own real historical scoring volatility — not a
number ESPN hands us, and not a fabricated one either.

Model: treat each team's likely final score as roughly Normal, centered
on (current score + points not yet scored by projection), with the
league's actual observed score standard deviation as the spread. The
probability team A finishes ahead of team B is then the standard
normal CDF of the score-differential z-score. This is a real, if
simple, model — deliberately not fancier than the inputs justify (we
don't track which specific players have finished their games yet, so
"points not yet scored" is approximated as the team's remaining
season-long projection rather than a live, per-player remaining
estimate).
"""
import math

# Fallback used only if a season has too little real data yet to compute
# its own volatility (get_team_score_stdev returns None) — a reasonable
# generic fantasy-football weekly score spread, not tuned to this league.
_DEFAULT_STDEV = 25.0


# A matchup that isn't mathematically over never shows 100% (or 0%) —
# ESPN does the same with its ">99.9%".
_UNDECIDED_CAP = 99.9


def estimate_win_probability(
    my_score: float,
    my_projected_total: float,
    opp_score: float,
    opp_projected_total: float,
    score_stdev: float | None,
    my_remaining_share: float = 1.0,
    opp_remaining_share: float = 1.0,
) -> float:
    """Returns my probability of winning, as a percentage (0-100).

    *_remaining_share (live_projection.remaining_share) is how much of
    each team's week is still to be played, 0..1. A team's uncertainty
    is the league's full-week spread scaled by the square root of that
    — the variance of points still to come shrinks with the playing
    time left — so the odds tighten as games finish. Real report,
    2026-10-05: both teams had nobody left, the leader was shown short
    of 100% because the full-week spread was applied to a finished
    matchup. With nothing left on either side the result is exact:
    100 / 0, or 50 for a tie."""
    my_expected_final = max(my_score, my_projected_total)
    opp_expected_final = max(opp_score, opp_projected_total)

    # Postgres's stddev_pop() (queries/league.py's get_team_score_stdev)
    # returns a Decimal, not a float — float() up front so the math
    # below doesn't hit "unsupported operand type(s)" against math.sqrt.
    stdev = float(score_stdev) if score_stdev and score_stdev > 0 else _DEFAULT_STDEV
    my_left = min(max(float(my_remaining_share), 0.0), 1.0)
    opp_left = min(max(float(opp_remaining_share), 0.0), 1.0)
    # Two independent teams: variances add. Each team's variance is the
    # full-week variance times its share of the week still to play.
    combined_stdev = stdev * math.sqrt(my_left + opp_left)

    diff = my_expected_final - opp_expected_final
    if combined_stdev == 0:
        return 100.0 if diff > 0 else 0.0 if diff < 0 else 50.0

    z = diff / combined_stdev
    probability = round(0.5 * (1 + math.erf(z / math.sqrt(2))) * 100, 1)
    return min(max(probability, 100 - _UNDECIDED_CAP), _UNDECIDED_CAP)
