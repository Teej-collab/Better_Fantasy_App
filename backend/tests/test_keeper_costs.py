"""Tests for app/domain/keeper_costs.py: what each keeper costs."""
from app.domain.keeper_costs import assign_rounds, base_cost


def test_last_round_is_espns_default_whatever_he_cost_before():
    assert base_cost("last_round", 1, 15, prior_round=3, kept_before=True) == 15


def test_round_drafted_costs_where_he_went_and_pickups_cost_the_last_round():
    assert base_cost("round_drafted", 1, 15, prior_round=6, kept_before=False) == 6
    assert base_cost("round_drafted", 1, 15, prior_round=None, kept_before=False) == 15


def test_escalating_gets_earlier_each_year_kept_but_not_past_round_one():
    assert base_cost("escalating", 2, 15, prior_round=6, kept_before=False) == 6  # first year: round drafted
    assert base_cost("escalating", 2, 15, prior_round=6, kept_before=True) == 4  # kept at 6 last year
    assert base_cost("escalating", 2, 15, prior_round=1, kept_before=True) == 1


def test_clashes_move_to_the_next_earlier_round_you_hold():
    held = set(range(1, 16))
    assert assign_rounds([("a", 15), ("b", 15)], held) == {"a": 15, "b": 14}
    # You traded away your 9th: a keeper costing round 9 takes the 8th.
    assert assign_rounds([("a", 9)], held - {9}) == {"a": 8}
    # Nothing earlier left: the next later pick you hold.
    assert assign_rounds([("a", 1)], {5, 6}) == {"a": 5}
