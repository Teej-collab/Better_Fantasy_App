from app.domain.draft_autopick import _position_capacity, choose_autopick

_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7}

# Already sorted ascending by search_rank, same as the caller (see
# draft_engine.py's query) is documented to hand choose_autopick — this
# function itself never re-sorts.
_POOL = [
    {"sleeper_player_id": "p-rb1", "position": "RB", "search_rank": 1},
    {"sleeper_player_id": "p-wr1", "position": "WR", "search_rank": 2},
    {"sleeper_player_id": "p-rb2", "position": "RB", "search_rank": 3},
    {"sleeper_player_id": "p-qb1", "position": "QB", "search_rank": 5},
    {"sleeper_player_id": "p-te1", "position": "TE", "search_rank": 10},
    {"sleeper_player_id": "p-def1", "position": "DEF", "search_rank": 200},
    {"sleeper_player_id": "p-k1", "position": "K", "search_rank": 250},
]


def test_position_capacity_is_starting_slot_plus_flex_plus_full_bench():
    # RB: 2 starting + 1 flex (flex-eligible) + 7 bench = 10.
    assert _position_capacity("RB", _ROSTER_SLOTS) == 10
    # QB: 1 starting + 0 flex (not flex-eligible) + 7 bench = 8.
    assert _position_capacity("QB", _ROSTER_SLOTS) == 8
    # K: 1 starting + 0 flex + 7 bench = 8.
    assert _position_capacity("K", _ROSTER_SLOTS) == 8


def test_choose_autopick_picks_best_overall_not_by_position_need():
    """The actual bug report: an empty roster used to always autodraft a
    QB with the very first pick, regardless of rank, because the old
    algorithm filled starting slots in a fixed QB-first order. Real
    ADP-driven autodraft (ESPN/Sleeper) just takes the single best-ranked
    player — here that's the rank-1 RB, not the rank-5 QB, even though
    the roster still needs a QB and doesn't have one yet."""
    pick = choose_autopick([], _ROSTER_SLOTS, _POOL)
    assert pick["sleeper_player_id"] == "p-rb1"


def test_choose_autopick_still_best_overall_after_some_picks():
    # Already has a QB and a WR — best remaining overall is still p-rb1
    # (rank 1), not a QB/WR pick to "balance" the roster.
    pick = choose_autopick(["QB", "WR"], _ROSTER_SLOTS, _POOL)
    assert pick["sleeper_player_id"] == "p-rb1"


def test_choose_autopick_skips_a_saturated_position():
    # 8 QBs already rostered == QB's full capacity (1 starting + 7
    # bench) — no more QBs make sense for this roster, so even though
    # p-qb1 is technically still "available," autopick skips straight
    # to the next-best real pick instead.
    rostered = ["QB"] * 8
    pool = [{"sleeper_player_id": "p-qb-extra", "position": "QB", "search_rank": 1}] + _POOL
    pick = choose_autopick(rostered, _ROSTER_SLOTS, pool)
    assert pick["sleeper_player_id"] == "p-rb1"


def test_choose_autopick_falls_back_to_best_overall_when_everything_saturated():
    # Every position in the pool is already at its full capacity —
    # there's nothing eligible left, so autopick falls back to the
    # single best-ranked player in the pool rather than returning None.
    rostered = ["QB"] * 8 + ["RB"] * 10 + ["WR"] * 10 + ["TE"] * 9 + ["DEF"] * 8 + ["K"] * 8
    pick = choose_autopick(rostered, _ROSTER_SLOTS, _POOL)
    assert pick["sleeper_player_id"] == _POOL[0]["sleeper_player_id"]


def test_choose_autopick_returns_none_on_empty_pool():
    assert choose_autopick([], _ROSTER_SLOTS, []) is None
