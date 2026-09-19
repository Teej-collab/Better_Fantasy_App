"""app/domain/nfl_schedule.py's live_status_by_pro_team — pure function,
no DB/network involved. Added 2026-09-13 alongside the fix that made
this read the public scoreboard poll (app/providers/nfl_scoreboard.py)
instead of app.gamecast.service's own viewer-gated cache, which had no
test coverage of its own at all before this."""
from app.domain.nfl_schedule import game_status_by_pro_team, live_status_by_pro_team


def _game(home, away, state="in", possession=None, is_redzone=False):
    return {
        "home_team": home,
        "away_team": away,
        "state": state,
        "possession_team_abbr": possession,
        "is_redzone": is_redzone,
    }


def test_team_with_possession_is_on_offense():
    lookup = live_status_by_pro_team([_game("CHI", "CAR", possession="CHI")])
    assert lookup["CHI"]["on_offense"] is True
    assert lookup["CAR"]["on_offense"] is False


def test_redzone_only_true_for_the_team_that_has_possession():
    lookup = live_status_by_pro_team([_game("BAL", "IND", possession="BAL", is_redzone=True)])
    assert lookup["BAL"]["is_redzone"] is True
    # The defense isn't "in the red zone" just because the offense is.
    assert lookup["IND"]["is_redzone"] is False


def test_game_not_in_progress_is_excluded_entirely():
    lookup = live_status_by_pro_team([_game("KC", "DEN", state="pre", possession="KC")])
    assert lookup == {}


def test_a_team_not_playing_this_week_has_no_entry():
    lookup = live_status_by_pro_team([_game("CHI", "CAR", possession="CHI")])
    assert "SF" not in lookup


def test_empty_scoreboard_returns_empty_lookup():
    assert live_status_by_pro_team([]) == {}


def test_game_status_maps_espn_states_to_the_three_matchup_screen_states():
    lookup = game_status_by_pro_team([
        _game("KC", "DEN", state="pre"),
        _game("CHI", "CAR", state="in"),
        _game("SF", "SEA", state="post"),
    ])
    assert lookup["KC"] == "scheduled"
    assert lookup["DEN"] == "scheduled"
    assert lookup["CHI"] == "in_progress"
    assert lookup["CAR"] == "in_progress"
    assert lookup["SF"] == "final"
    assert lookup["SEA"] == "final"


def test_game_status_has_no_entry_for_a_team_not_playing_this_week():
    lookup = game_status_by_pro_team([_game("CHI", "CAR", state="in")])
    assert "GB" not in lookup


def test_game_status_empty_scoreboard_returns_empty_lookup():
    assert game_status_by_pro_team([]) == {}
