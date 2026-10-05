from app.domain.win_probability import estimate_win_probability


def test_equal_expected_scores_is_fifty_fifty():
    prob = estimate_win_probability(
        my_score=100, my_projected_total=100, opp_score=100, opp_projected_total=100, score_stdev=20
    )
    assert prob == 50.0


def test_higher_expected_score_favored():
    prob = estimate_win_probability(
        my_score=110, my_projected_total=110, opp_score=90, opp_projected_total=90, score_stdev=20
    )
    assert prob > 50.0


def test_lower_expected_score_disfavored():
    prob = estimate_win_probability(
        my_score=90, my_projected_total=90, opp_score=110, opp_projected_total=110, score_stdev=20
    )
    assert prob < 50.0


def test_symmetric_between_two_teams():
    a = estimate_win_probability(
        my_score=120, my_projected_total=120, opp_score=100, opp_projected_total=100, score_stdev=20
    )
    b = estimate_win_probability(
        my_score=100, my_projected_total=100, opp_score=120, opp_projected_total=120, score_stdev=20
    )
    assert round(a + b, 1) == 100.0


def test_uses_projected_total_when_higher_than_current_score():
    # Still-in-progress team: current score is low but a lot of
    # projected points haven't come in yet — should be favored over a
    # team whose final score is already locked in lower than that.
    prob = estimate_win_probability(
        my_score=10, my_projected_total=120, opp_score=100, opp_projected_total=100, score_stdev=20
    )
    assert prob > 50.0


def test_falls_back_to_default_stdev_when_none():
    # Just needs to not blow up when a season has no real stdev yet.
    prob = estimate_win_probability(
        my_score=100, my_projected_total=100, opp_score=100, opp_projected_total=100, score_stdev=None
    )
    assert prob == 50.0


def test_returns_percentage_bounded_reasonably():
    prob = estimate_win_probability(
        my_score=200, my_projected_total=200, opp_score=10, opp_projected_total=10, score_stdev=15
    )
    assert 0 <= prob <= 100
    assert prob > 95


def test_finished_matchup_is_certain():
    """Real report, 2026-10-05: nobody left to play on either side, the
    leader must be at 100%, not short of it."""
    prob = estimate_win_probability(
        my_score=112.4, my_projected_total=112.4, opp_score=98.1, opp_projected_total=98.1,
        score_stdev=25, my_remaining_share=0, opp_remaining_share=0,
    )
    assert prob == 100.0
    lose = estimate_win_probability(
        my_score=98.1, my_projected_total=98.1, opp_score=112.4, opp_projected_total=112.4,
        score_stdev=25, my_remaining_share=0, opp_remaining_share=0,
    )
    assert lose == 0.0


def test_finished_tie_is_even():
    prob = estimate_win_probability(
        my_score=100, my_projected_total=100, opp_score=100, opp_projected_total=100,
        score_stdev=25, my_remaining_share=0, opp_remaining_share=0,
    )
    assert prob == 50.0


def test_less_left_to_play_means_more_certainty():
    early = estimate_win_probability(
        my_score=60, my_projected_total=110, opp_score=50, opp_projected_total=100,
        score_stdev=25, my_remaining_share=0.6, opp_remaining_share=0.6,
    )
    late = estimate_win_probability(
        my_score=105, my_projected_total=110, opp_score=95, opp_projected_total=100,
        score_stdev=25, my_remaining_share=0.1, opp_remaining_share=0.1,
    )
    assert 50 < early < late


def test_undecided_matchup_never_shows_a_certainty():
    """One kicker left on the trailing side, 40 points down — not
    mathematically over, so it caps at 99.9, never 100."""
    prob = estimate_win_probability(
        my_score=130, my_projected_total=130, opp_score=90, opp_projected_total=98,
        score_stdev=25, my_remaining_share=0, opp_remaining_share=0.05,
    )
    assert prob == 99.9
