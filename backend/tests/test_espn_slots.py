from app.providers.espn.slots import LineupSlot, slot_id_from_label, slot_label


def test_verified_slot_ids_match_position_map():
    # These are the exact IDs adapter.py already relies on in production
    # to parse real rosters correctly (see slots.py's module docstring).
    assert LineupSlot.QB == 0
    assert LineupSlot.RB == 2
    assert LineupSlot.WR == 4
    assert LineupSlot.TE == 6
    assert LineupSlot.DST == 16
    assert LineupSlot.K == 17
    assert LineupSlot.BENCH == 20
    assert LineupSlot.IR == 21
    assert LineupSlot.FLEX == 23


def test_slot_label_round_trips_for_bench_and_ir():
    # The exact bug this file guards against: POSITION_MAP's own string
    # keys don't include 'BE' or 'IR' as reverse entries, only espn_api's
    # int->label direction has them.
    assert slot_label(LineupSlot.BENCH) == "BE"
    assert slot_id_from_label("BE") == LineupSlot.BENCH
    assert slot_label(LineupSlot.IR) == "IR"
    assert slot_id_from_label("IR") == LineupSlot.IR


def test_slot_label_round_trips_for_this_leagues_actual_flex_label():
    # This league's real FLEX slot is labeled "RB/WR/TE" by ESPN, not
    # "FLEX" — confirmed against real production data (TODO.md Phase 6).
    assert slot_label(LineupSlot.FLEX) == "RB/WR/TE"
    assert slot_id_from_label("RB/WR/TE") == LineupSlot.FLEX


def test_flex_alias_resolves_to_the_same_id():
    # A human (or a /setlineup command) will type "FLEX", not "RB/WR/TE".
    assert slot_id_from_label("FLEX") == LineupSlot.FLEX
    assert slot_id_from_label("flex") == LineupSlot.FLEX


def test_unrecognized_label_returns_none_not_an_exception():
    assert slot_id_from_label("NOT_A_REAL_SLOT") is None
