"""League Bets' numbers (app/domain/league_bets.py)."""
from app.domain import league_bets as ld


def _leg(status, **kw):
    return {"id": kw.pop("id", 1), "status": status, "market": "player_prop", "direction": "over", **kw}


def _bet(status, legs=None, odds=None):
    return {"status": status, "odds_american": odds, "legs": legs or [_leg(status if status != "cashed_out" else "won")]}


def test_units_count_every_bet_as_one_unit_at_its_odds():
    assert ld.bet_units(_bet("won", odds=450)) == 4.5
    assert ld.bet_units(_bet("won", odds=-110)) == 0.91
    assert ld.bet_units(_bet("won")) == 1.0
    assert ld.bet_units(_bet("lost", odds=900)) == -1.0
    assert ld.bet_units(_bet("push")) == 0.0
    assert ld.bet_units(_bet("open", odds=200)) is None
    # A straight bet with odds only on its leg.
    assert ld.bet_units({"status": "won", "odds_american": None, "legs": [_leg("won", odds_american=150)]}) == 1.5


def test_record_streak_and_form():
    bets = [_bet("won", odds=100), _bet("lost"), _bet("won", odds=200), _bet("push"), _bet("won", odds=-200), _bet("open")]
    rec = ld.record(bets)
    assert (rec["wins"], rec["losses"], rec["pushes"], rec["open"]) == (3, 1, 1, 1)
    assert rec["units"] == 1 - 1 + 2 + 0 + 0.5
    assert rec["streak"] == "W2"  # the push doesn't break it
    assert rec["hit_rate"] == 0.75
    assert ld.form(bets, 4) == ["won", "push", "won", "open"]
    assert ld.record([])["streak"] is None


def test_one_leg_away_and_bad_beats():
    sweating = _bet("open", [_leg("won", id=1), _leg("open", id=2, current=61, target=80)])
    assert ld.one_leg_away(sweating)["id"] == 2
    assert ld.needs_more(ld.one_leg_away(sweating)) == 19
    assert ld.one_leg_away(_bet("open", [_leg("open", id=1), _leg("open", id=2)])) is None
    assert ld.one_leg_away(_bet("open", [_leg("open")])) is None

    beat = _bet("lost", [_leg("won", id=1), _leg("won", id=2), _leg("lost", id=3, current=48, target=49.5)])
    assert ld.bad_beat(beat) == {"leg": beat["legs"][2], "missed_by": 1.5}
    # Two legs lost isn't a bad beat, nor is a straight bet.
    assert ld.bad_beat(_bet("lost", [_leg("lost", id=1), _leg("lost", id=2)])) is None
    assert ld.bad_beat(_bet("lost")) is None


def test_style_and_tendencies():
    bets = [
        _bet("won", [_leg("won", player_name="Gibbs", stat_label="Rushing yards"), _leg("won", player_name="Gibbs", stat_label="Rushing yards")]),
        _bet("lost", [_leg("lost", player_name="Lamb", stat_label="Receiving yards", direction="under")]),
    ]
    style = ld.style(bets)
    assert style["favorite_player"] == {"player_name": "Gibbs", "legs": 2, "wins": 2, "losses": 0}
    assert style["go_to_stat"]["label"] == "Rushing yards"
    assert style["parlay_rate"] == 0.5 and style["avg_parlay_legs"] == 2
    assert round(style["overs_share"], 2) == 0.67
    t = ld.tendencies(bets)
    assert t["overs"] == {"wins": 2, "losses": 0} and t["unders"] == {"wins": 0, "losses": 1}
    assert t["parlay_hit_rate"] == 1.0
