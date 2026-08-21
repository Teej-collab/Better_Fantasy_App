from datetime import datetime
from zoneinfo import ZoneInfo

from app.domain.chug_deadline import get_mnf_deadline, is_past_mnf_deadline

ET = ZoneInfo("America/New_York")

# A real Monday in the test data's timeframe — 2026-08-24 is a Monday.
_MONDAY_GAME = {
    "name": "Seattle Seahawks at Tennessee Titans",
    "date": "2026-08-25T00:15Z",  # 8:15 PM ET Monday
}
_THURSDAY_GAME = {
    "name": "Las Vegas Raiders at Houston Texans",
    "date": "2026-08-21T00:00Z",  # 8:00 PM ET Thursday
}


def test_get_mnf_deadline_uses_real_kickoff_when_a_monday_game_exists():
    now = datetime(2026, 8, 24, 12, 0, tzinfo=ET)  # Monday midday
    deadline = get_mnf_deadline([_THURSDAY_GAME, _MONDAY_GAME], now)
    assert deadline == datetime(2026, 8, 24, 20, 15, tzinfo=ET)


def test_get_mnf_deadline_falls_back_when_no_monday_game_in_scoreboard():
    now = datetime(2026, 8, 24, 12, 0, tzinfo=ET)
    deadline = get_mnf_deadline([_THURSDAY_GAME], now)  # no Monday game at all
    assert deadline == datetime(2026, 8, 24, 20, 15, tzinfo=ET)  # fallback slot


def test_is_past_mnf_deadline_false_before_kickoff():
    now = datetime(2026, 8, 24, 19, 0, tzinfo=ET)  # Monday, before 8:15 PM
    assert is_past_mnf_deadline([_MONDAY_GAME], now) is False


def test_is_past_mnf_deadline_true_after_kickoff():
    now = datetime(2026, 8, 24, 23, 0, tzinfo=ET)  # Monday night, after kickoff
    assert is_past_mnf_deadline([_MONDAY_GAME], now) is True


def test_is_past_mnf_deadline_true_once_the_week_is_over():
    now = datetime(2026, 8, 26, 9, 0, tzinfo=ET)  # Wednesday — definitely past
    assert is_past_mnf_deadline([_MONDAY_GAME], now) is True


def test_deadline_anchors_to_the_monday_of_the_current_week_regardless_of_weekday():
    # Checking on a Saturday should still compute that same week's Monday.
    now = datetime(2026, 8, 22, 10, 0, tzinfo=ET)  # Saturday
    deadline = get_mnf_deadline([_MONDAY_GAME], now)
    assert deadline.date().isoformat() == "2026-08-24"
