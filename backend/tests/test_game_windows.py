from datetime import datetime
from zoneinfo import ZoneInfo

from app.game_windows import is_within_nfl_game_window

ET = ZoneInfo("America/New_York")


def test_sunday_afternoon_is_in_window():
    assert is_within_nfl_game_window(datetime(2026, 8, 23, 13, 0, tzinfo=ET))  # a Sunday


def test_thursday_night_is_in_window():
    assert is_within_nfl_game_window(datetime(2026, 8, 20, 20, 0, tzinfo=ET))  # a Thursday


def test_monday_night_is_in_window():
    assert is_within_nfl_game_window(datetime(2026, 8, 24, 21, 0, tzinfo=ET))  # a Monday


def test_tuesday_is_never_in_window():
    assert not is_within_nfl_game_window(datetime(2026, 8, 25, 20, 0, tzinfo=ET))  # a Tuesday


def test_sunday_morning_before_games_is_not_in_window():
    assert not is_within_nfl_game_window(datetime(2026, 8, 23, 9, 0, tzinfo=ET))


def test_thursday_afternoon_before_kickoff_is_not_in_window():
    assert not is_within_nfl_game_window(datetime(2026, 8, 20, 14, 0, tzinfo=ET))


def test_respects_timezone_not_just_wall_clock():
    # 23:30 UTC on a Sunday is only 19:30 ET the same day — still in window.
    utc_time = datetime(2026, 8, 23, 23, 30, tzinfo=ZoneInfo("UTC"))
    assert is_within_nfl_game_window(utc_time)
