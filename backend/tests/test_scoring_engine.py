from app.domain.scoring_engine import DST_BASELINE_POINTS, compute_player_points, rules_dict_from_rows

# Matches this league's real seeded rules (migration fcd0e76ead34) for
# the categories exercised here.
_RULES = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -2,
    "rush_yd": 0.1, "rush_td": 6,
    "rec_yd": 0.1, "rec": 1, "rec_td": 6,
    "fum_lost": -2,
}


def test_qb_stat_line():
    stat_line = {"pass_yd": 250, "pass_td": 2, "pass_int": 1}
    # 250*0.04=10, 2*4=8, 1*-2=-2 -> 16
    assert compute_player_points(stat_line, _RULES) == 16.0


def test_ppr_receiver_stat_line():
    stat_line = {"rec": 7, "rec_yd": 85, "rec_td": 1}
    # 7*1=7, 85*0.1=8.5, 1*6=6 -> 21.5
    assert compute_player_points(stat_line, _RULES) == 21.5


def test_negative_categories_reduce_total():
    stat_line = {"rush_yd": 40, "rush_td": 1, "fum_lost": 1}
    # 40*0.1=4, 1*6=6, 1*-2=-2 -> 8
    assert compute_player_points(stat_line, _RULES) == 8.0


def test_unknown_category_in_stat_line_contributes_nothing():
    stat_line = {"pass_yd": 100, "some_unmapped_stat": 999}
    # 100*0.04=4, unmapped category not in rules -> 0
    assert compute_player_points(stat_line, _RULES) == 4.0


def test_empty_stat_line_scores_zero():
    assert compute_player_points({}, _RULES) == 0.0


def test_rounds_to_two_decimal_places():
    stat_line = {"rec_yd": 33}  # 33 * 0.1 = 3.3000000000000003 in raw float math
    assert compute_player_points(stat_line, {"rec_yd": 0.1}) == 3.3


def test_baseline_defaults_to_zero_for_individual_players():
    stat_line = {"rec": 7, "rec_yd": 85, "rec_td": 1}
    assert compute_player_points(stat_line, _RULES) == compute_player_points(stat_line, _RULES, baseline=0.0)


def test_dst_baseline_adds_ten_before_events_are_applied():
    """This league's real rule (confirmed by the project owner, Aug 26
    2026): a team D/ST unit starts every game at 10 fantasy points, not
    0, before its own sacks/turnovers/points-allowed tier/etc. are
    applied — see weekly_stats.py's team-D/ST branch, the only caller
    that passes this baseline."""
    stat_line = {"def_sack": 2, "pts_allow_0": 1}  # 2*1=2, 1*5=5 -> 7 + baseline
    rules = {"def_sack": 1, "pts_allow_0": 5}
    assert compute_player_points(stat_line, rules, baseline=DST_BASELINE_POINTS) == 17.0


def test_dst_baseline_survives_a_net_negative_game():
    stat_line = {"pts_allow_46_plus": 1, "yds_allow_550_plus": 1}
    rules = {"pts_allow_46_plus": -5, "yds_allow_550_plus": -7}
    # 10 + -5 + -7 = -2 — a real bad-enough defensive game goes negative.
    assert compute_player_points(stat_line, rules, baseline=DST_BASELINE_POINTS) == -2.0


class _FakeRow(dict):
    def __getitem__(self, key):
        return dict.__getitem__(self, key)


def test_rules_dict_from_rows_casts_decimal_to_float():
    from decimal import Decimal

    rows = [
        _FakeRow(stat_category="pass_yd", points_per_unit=Decimal("0.04")),
        _FakeRow(stat_category="pass_td", points_per_unit=Decimal("4")),
    ]
    rules = rules_dict_from_rows(rows)
    assert rules == {"pass_yd": 0.04, "pass_td": 4.0}
    assert all(isinstance(v, float) for v in rules.values())
