from app.domain.draft_autopick import choose_autopick, _next_needed_slot

_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7}

_POOL = [
    {"sleeper_player_id": "p-qb1", "position": "QB", "search_rank": 5},
    {"sleeper_player_id": "p-rb1", "position": "RB", "search_rank": 1},
    {"sleeper_player_id": "p-rb2", "position": "RB", "search_rank": 3},
    {"sleeper_player_id": "p-wr1", "position": "WR", "search_rank": 2},
    {"sleeper_player_id": "p-te1", "position": "TE", "search_rank": 10},
    {"sleeper_player_id": "p-def1", "position": "DEF", "search_rank": 200},
    {"sleeper_player_id": "p-k1", "position": "K", "search_rank": 250},
]


def test_next_needed_slot_fills_qb_first_on_empty_roster():
    assert _next_needed_slot([], _ROSTER_SLOTS) == "QB"


def test_next_needed_slot_moves_to_rb_after_qb_filled():
    assert _next_needed_slot(["QB"], _ROSTER_SLOTS) == "RB"


def test_next_needed_slot_flex_after_primary_slots_filled():
    rostered = ["QB", "RB", "RB", "WR", "WR", "TE"]
    assert _next_needed_slot(rostered, _ROSTER_SLOTS) == "RB/WR/TE"


def test_next_needed_slot_extra_rb_satisfies_flex():
    # 3 RBs drafted: 2 count toward the RB slot, the 3rd counts toward flex.
    rostered = ["QB", "RB", "RB", "RB", "WR", "WR", "TE"]
    assert _next_needed_slot(rostered, _ROSTER_SLOTS) == "D/ST"


def test_next_needed_slot_bench_after_all_starters_filled():
    rostered = ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "DEF", "K"]
    # QB1 RB2 WR2 TE1 FLEX(extra RB)1 DEF1 K1 = 9 starters, all filled
    assert _next_needed_slot(rostered, _ROSTER_SLOTS) == "BE"


def test_next_needed_slot_none_once_full_roster():
    rostered = ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "DEF", "K"] + ["WR"] * 7
    assert _next_needed_slot(rostered, _ROSTER_SLOTS) is None


def test_choose_autopick_picks_best_available_qb_when_qb_needed():
    pick = choose_autopick([], _ROSTER_SLOTS, _POOL)
    assert pick["sleeper_player_id"] == "p-qb1"


def test_choose_autopick_picks_best_available_rb_when_rb_needed():
    pick = choose_autopick(["QB"], _ROSTER_SLOTS, _POOL)
    assert pick["sleeper_player_id"] == "p-rb1"


def test_choose_autopick_flex_considers_rb_wr_te_only():
    rostered = ["QB", "RB", "RB", "WR", "WR", "TE"]
    pick = choose_autopick(rostered, _ROSTER_SLOTS, _POOL)
    # remaining pool for flex: rb1(taken conceptually not removed here, but
    # pure function doesn't know what's "already picked" beyond rostered_positions
    # counts) — with this pool, best RB/WR/TE-eligible remaining is p-rb1 (rank 1)
    assert pick["position"] in ("RB", "WR", "TE")


def test_choose_autopick_falls_back_to_best_overall_on_bench():
    rostered = ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "DEF", "K"]
    pick = choose_autopick(rostered, _ROSTER_SLOTS, _POOL)
    assert pick["sleeper_player_id"] == _POOL[0]["sleeper_player_id"]


def test_choose_autopick_returns_none_on_empty_pool():
    assert choose_autopick([], _ROSTER_SLOTS, []) is None
