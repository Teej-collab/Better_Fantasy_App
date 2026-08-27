from app.domain.scoring_engine import compute_player_points, rules_dict_from_rows

# This league's real seeded D/ST tier values (migration fcd0e76ead34),
# not assumed — pts_allow_0 and yds_allow_lt100 are the two categories
# that fire when the opponent has 0 points and under 100 yards, i.e.
# right at kickoff.
_DST_RULES = {
    "pts_allow_0": 5, "pts_allow_1_6": 4, "pts_allow_7_13": 3,
    "yds_allow_lt100": 5, "yds_allow_100_199": 3,
    "pts_allow_46_plus": -5, "yds_allow_550_plus": -7,
    "def_sack": 1, "def_int": 2, "def_fum_rec": 2, "def_block": 2,
}

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


def test_dst_kickoff_state_scores_ten_with_no_special_baseline():
    """This league's real rule: a team D/ST starts a game at 10 fantasy
    points — but that's a natural consequence of pts_allow_0 (5) +
    yds_allow_lt100 (5), the real tiers that fire when the opponent has
    scored/gained nothing yet, not a separate hardcoded add-on. Same
    compute_player_points() formula as any individual player — no
    baseline parameter exists."""
    stat_line = {"pts_allow_0": 1, "yds_allow_lt100": 1}
    assert compute_player_points(stat_line, _DST_RULES) == 10.0


def test_dst_yardage_tier_change_is_a_live_recompute():
    """Proves this is a genuine recompute from current state, not "10
    minus something": moving to the next yards-allowed tier changes the
    total by exactly the difference between the two tiers' own values,
    with no other hidden term involved."""
    stat_line = {"pts_allow_0": 1, "yds_allow_100_199": 1}
    assert compute_player_points(stat_line, _DST_RULES) == 8.0  # 5 + 3


def test_dst_points_tier_change_is_a_live_recompute():
    stat_line = {"pts_allow_7_13": 1, "yds_allow_lt100": 1}
    assert compute_player_points(stat_line, _DST_RULES) == 8.0  # 3 + 5


def test_dst_sack_adds_on_top_of_tier_state():
    stat_line = {"pts_allow_0": 1, "yds_allow_lt100": 1, "def_sack": 1}
    assert compute_player_points(stat_line, _DST_RULES) == 11.0


def test_dst_interception_adds_on_top_of_tier_state():
    stat_line = {"pts_allow_0": 1, "yds_allow_lt100": 1, "def_int": 1}
    assert compute_player_points(stat_line, _DST_RULES) == 12.0


def test_dst_fumble_recovery_adds_on_top_of_tier_state():
    stat_line = {"pts_allow_0": 1, "yds_allow_lt100": 1, "def_fum_rec": 1}
    assert compute_player_points(stat_line, _DST_RULES) == 12.0


def test_dst_multiple_simultaneous_events_each_apply_exactly_once():
    """Sack, forced-fumble-adjacent recovery, and a block in the same
    stat line — every category contributes its own value once, none
    overwrite or suppress each other."""
    stat_line = {
        "pts_allow_0": 1, "yds_allow_lt100": 1,
        "def_sack": 1, "def_fum_rec": 1, "def_block": 1,
    }
    assert compute_player_points(stat_line, _DST_RULES) == 15.0  # 5+5+1+2+2


def test_dst_can_go_negative_in_a_bad_game():
    stat_line = {"pts_allow_46_plus": 1, "yds_allow_550_plus": 1}
    assert compute_player_points(stat_line, _DST_RULES) == -12.0  # -5 + -7


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
