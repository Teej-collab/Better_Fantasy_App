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


def estimate_win_probability(
    my_score: float,
    my_projected_total: float,
    opp_score: float,
    opp_projected_total: float,
    score_stdev: float | None,
) -> float:
    """Returns my probability of winning, as a percentage (0-100)."""
    my_expected_final = max(my_score, my_projected_total)
    opp_expected_final = max(opp_score, opp_projected_total)

    # Postgres's stddev_pop() (queries/league.py's get_team_score_stdev)
    # returns a Decimal, not a float — float() up front so the math
    # below doesn't hit "unsupported operand type(s)" against math.sqrt.
    stdev = float(score_stdev) if score_stdev and score_stdev > 0 else _DEFAULT_STDEV
    combined_stdev = stdev * math.sqrt(2)  # two independent teams' variance

    z = (my_expected_final - opp_expected_final) / combined_stdev
    probability = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return round(probability * 100, 1)
