"""Per-play fantasy stat attribution for Gamecast's Last Play card —
fixtures are real ESPN core-API plays from NO @ DET, 2026 week 1
(event 401872923)."""
from app.domain.scoring_engine import compute_player_points
from app.gamecast.last_play import play_stat_lines

GOFF, ST_BROWN, BATES, GIBBS = 3046779, 4374302, 4689936, 4429795
SHOUGH, MCCREARY, WONNUM = 4360689, 4371973, 4038849

RULES = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -2, "rush_yd": 0.1, "rush_td": 6, "rec": 1, "rec_yd": 0.1,
    "rec_td": 6, "fum_lost": -2, "xp_made": 1, "fg_yds": 0.1, "fg_miss_40_49": -1, "qb_tackle": 15,
    "def_sack": 1, "def_int": 2, "def_fum_rec": 2,
}


def _core(play_type, yards, participants, scoring=False, turnover=False):
    return {
        "type": play_type, "yards": yards, "is_scoring": scoring, "is_turnover": turnover,
        "participants": [{"role": role, "espn_id": espn_id} for role, espn_id in participants],
    }


def test_passing_touchdown_credits_passer_receiver_and_kicker():
    core = _core("Passing Touchdown", 19, [
        ("passer", GOFF), ("receiver", ST_BROWN), ("scorer", ST_BROWN), ("kicker", BATES), ("patScorer", BATES),
    ], scoring=True)
    lines, dst = play_stat_lines(core, {})
    assert compute_player_points(lines[ST_BROWN], RULES) == 8.9
    assert compute_player_points(lines[GOFF], RULES) == 4.76
    assert compute_player_points(lines[BATES], RULES) == 1
    assert dst == {}


def test_rushing_touchdown():
    core = _core("Rushing Touchdown", 1, [("rusher", GIBBS), ("scorer", GIBBS)], scoring=True)
    lines, _ = play_stat_lines(core, {})
    assert compute_player_points(lines[GIBBS], RULES) == 6.1


def test_incompletion_scores_nothing_for_the_target():
    core = _core("Pass Incompletion", 0, [("passer", SHOUGH), ("receiver", 4036131)])
    lines, _ = play_stat_lines(core, {})
    assert 4036131 not in lines
    assert SHOUGH not in lines


def test_strip_sack_charges_the_fumbler_and_credits_the_defense():
    core = _core("Sack Opp Fumble Recovery", 0, [
        ("forcedBy", MCCREARY), ("sackedBy", MCCREARY), ("tackler", MCCREARY),
        ("passer", SHOUGH), ("fumbler", SHOUGH), ("recoverer", WONNUM), ("other", GIBBS),
    ], turnover=True)
    lines, dst = play_stat_lines(core, {})
    assert compute_player_points(lines[SHOUGH], RULES) == -2
    assert GIBBS not in lines
    assert compute_player_points(dst, RULES) == 3  # sack + fumble recovery


def test_interception_charges_the_passer_and_credits_the_defense():
    core = _core("Pass Interception Return", 1, [
        ("passer", SHOUGH), ("passDefender", 3045463), ("returner", 3045463),
    ], turnover=True)
    lines, dst = play_stat_lines(core, {})
    assert compute_player_points(lines[SHOUGH], RULES) == -2
    assert dst == {"def_int": 1}


def test_qb_making_a_tackle():
    core = _core("Pass Interception Return", 20, [("passer", SHOUGH), ("tackler", SHOUGH)], turnover=True)
    lines, _ = play_stat_lines(core, {SHOUGH: "QB"})
    assert compute_player_points(lines[SHOUGH], RULES) == 13  # -2 INT + 15 tackle


def test_missed_field_goal_uses_the_distance_tier():
    core = _core("Field Goal Missed", 44, [("kicker", BATES)])
    lines, _ = play_stat_lines(core, {})
    assert lines[BATES] == {"fg_miss_40_49": 1}
