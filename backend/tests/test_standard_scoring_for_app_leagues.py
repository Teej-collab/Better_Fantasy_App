from app.scripts.standard_scoring_for_app_leagues import _changes


def test_house_rules_move_to_standard_and_edits_are_kept():
    house = {"qb_tackle": 15, "fg_yds": 0.1, "fg_miss_0_29": -5, "fg_miss_30_39": -3, "fg_miss_40_49": -1,
             "fg_miss_50_plus": 0, "yds_allow_300_349": 1, "rec": 0.5, "pass_td": 6}
    out = _changes(house)
    assert out == {"qb_tackle": 0, "fg_yds": 0, "fg_miss_0_29": -1, "fg_miss_30_39": -1, "fg_miss_50_plus": -1,
                   "yds_allow_300_349": 0, "fg_made_0_39": 3, "fg_made_40_49": 4, "fg_made_50_plus": 5}
    # A commissioner's own values (Half PPR, 6-point passing TDs) aren't touched.
    assert "rec" not in out and "pass_td" not in out


def test_a_commissioner_edit_to_a_house_rule_is_left_alone():
    out = _changes({"qb_tackle": 5, "fg_yds": 0.2, "fg_miss_0_29": -2})
    assert out == {}


def test_already_standard_changes_nothing():
    assert _changes({"fg_made_0_39": 3, "fg_made_40_49": 4, "fg_made_50_plus": 5, "fg_miss_0_29": -1}) == {}
