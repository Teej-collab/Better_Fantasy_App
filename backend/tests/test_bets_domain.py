from app.domain import bets


def game(state, home="DAL", away="BAL", home_score=0, away_score=0):
    return {"state": state, "home_team": home, "away_team": away, "home_score": home_score, "away_score": away_score}


def prop(stat_key, line, direction="over"):
    return {"market": "player_prop", "stat_key": stat_key, "line": line, "direction": direction}


def test_over_wins_as_soon_as_the_line_is_beaten():
    leg = prop("rush_yd", 79.5)
    assert bets.evaluate_leg(leg, game("in"), {"rush_yd": 64})["status"] == "open"
    assert bets.evaluate_leg(leg, game("in"), {"rush_yd": 81})["status"] == "won"
    assert bets.evaluate_leg(leg, game("post"), {"rush_yd": 64})["status"] == "lost"


def test_under_loses_early_and_wins_at_the_final():
    leg = prop("rec", 4.5, "under")
    assert bets.evaluate_leg(leg, game("in"), {"rec": 5})["status"] == "lost"
    assert bets.evaluate_leg(leg, game("in"), {"rec": 3})["status"] == "open"
    assert bets.evaluate_leg(leg, game("post"), {"rec": 3})["status"] == "won"


def test_whole_number_line_can_push():
    assert bets.evaluate_leg(prop("rec", 5), game("post"), {"rec": 5})["status"] == "push"


def test_player_with_no_stats_yet_counts_as_zero():
    out = bets.evaluate_leg(prop("rec_yd", 40.5), game("in"), None)
    assert out == {"status": "open", "current": 0.0, "target": 40.5}


def test_combined_stats_add_up():
    out = bets.evaluate_leg(prop("rush_rec_yd", 99.5), game("in"), {"rush_yd": 60, "rec_yd": 41})
    assert out["current"] == 101 and out["status"] == "won"


def test_anytime_td_counts_any_kind_of_touchdown():
    leg = {"market": "player_prop", "stat_key": "anytime_td", "line": None, "direction": "yes"}
    assert bets.evaluate_leg(leg, game("in"), {"rec_td": 1})["status"] == "won"
    assert bets.evaluate_leg(leg, game("post"), {"rush_yd": 90})["status"] == "lost"
    two = {**leg, "line": 2}
    assert bets.evaluate_leg(two, game("in"), {"rush_td": 1})["status"] == "open"
    assert bets.evaluate_leg(two, game("in"), {"rush_td": 1, "rec_td": 1})["status"] == "won"


def test_spread_and_moneyline_wait_for_the_final():
    leg = {"market": "spread", "team_abbr": "BAL", "line": -2.5}
    assert bets.evaluate_leg(leg, game("in", home_score=10, away_score=20), None)["status"] == "open"
    assert bets.evaluate_leg(leg, game("post", home_score=31, away_score=34), None)["status"] == "won"
    assert bets.evaluate_leg({**leg, "line": -3}, game("post", home_score=31, away_score=34), None)["status"] == "push"
    ml = {"market": "moneyline", "team_abbr": "DAL", "line": None}
    assert bets.evaluate_leg(ml, game("post", home_score=31, away_score=34), None)["status"] == "lost"


def test_game_total_over_can_win_live():
    leg = {"market": "total", "line": 47.5, "direction": "over"}
    assert bets.evaluate_leg(leg, game("in", home_score=24, away_score=24), None)["status"] == "won"
    assert bets.evaluate_leg({**leg, "direction": "under"}, game("post", home_score=10, away_score=13), None)["status"] == "won"


def test_other_legs_stay_open_until_marked():
    assert bets.evaluate_leg({"market": "other", "line": None}, game("post"), None)["status"] == "open"
    assert bets.evaluate_leg({"market": "other", "status": "won"}, game("post"), None)["status"] == "won"


def test_bet_status_from_legs():
    assert bets.bet_status(["won", "open"]) == "open"
    assert bets.bet_status(["won", "lost", "open"]) == "lost"
    assert bets.bet_status(["won", "push"]) == "won"
    assert bets.bet_status(["push", "push"]) == "push"


def test_american_payout():
    assert bets.american_payout_cents(1000, 150) == 2500
    assert bets.american_payout_cents(1100, -110) == 2100


def test_normalize_leg_from_slip_text():
    leg = bets.normalize_leg({"market": "player_prop", "stat": "Rush + Rec Yds", "line": "99.5", "direction": "Over", "player_name": "Jahmyr Gibbs", "team_abbr": "det"})
    assert leg["stat_key"] == "rush_rec_yd" and leg["line"] == 99.5 and leg["direction"] == "over" and leg["team_abbr"] == "DET"
    td = bets.normalize_leg({"market": "player_prop", "stat": "Anytime Touchdown Scorer", "player_name": "X"})
    assert td["stat_key"] == "anytime_td" and td["direction"] == "yes"
    unknown = bets.normalize_leg({"market": "player_prop", "stat": "First touchdown scorer"})
    assert unknown["market"] == "other"


def test_name_key_ignores_suffixes_and_accents():
    assert bets.name_key("Kenneth Walker III") == bets.name_key("kenneth walker")
    assert bets.name_key("Amon-Ra St. Brown") == "amon ra st brown"
