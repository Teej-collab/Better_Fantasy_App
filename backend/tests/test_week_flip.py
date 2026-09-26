from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.domain.week_flip import get_week_flip_at, is_past_week_flip

_CT = ZoneInfo("America/Chicago")

# A normal Thu -> Mon week: TNF, Sunday, then MNF at 7:15 PM CDT
# (00:15Z Tuesday).
_NORMAL_WEEK = [
    {"date": "2026-09-18T00:15Z"},
    {"date": "2026-09-20T17:00Z"},
    {"date": "2026-09-22T00:15Z"},
]


def test_flips_tuesday_2pm_central_after_monday_night():
    assert get_week_flip_at(_NORMAL_WEEK) == datetime(2026, 9, 22, 14, 0, tzinfo=_CT)


def test_not_flipped_until_2pm_then_flipped():
    assert not is_past_week_flip(_NORMAL_WEEK, datetime(2026, 9, 22, 13, 59, tzinfo=_CT))
    assert is_past_week_flip(_NORMAL_WEEK, datetime(2026, 9, 22, 14, 0, tzinfo=_CT))


def test_follows_standard_time_after_dst_ends():
    # Monday Dec 7, 7:15 PM CST.
    flip = get_week_flip_at([{"date": "2026-12-08T01:15Z"}])
    assert flip == datetime(2026, 12, 8, 14, 0, tzinfo=_CT)
    assert flip.utcoffset().total_seconds() == -6 * 3600


def test_week_without_a_monday_game_still_flips_tuesday():
    assert get_week_flip_at([{"date": "2026-09-20T17:00Z"}]) == datetime(2026, 9, 22, 14, 0, tzinfo=_CT)


def test_game_moved_to_tuesday_flips_next_day_not_a_week_later():
    # Tuesday 7 PM CDT.
    assert get_week_flip_at([{"date": "2026-09-23T00:00Z"}]) == datetime(2026, 9, 23, 14, 0, tzinfo=_CT)


def test_no_kickoff_times_falls_back_to_flipping():
    assert get_week_flip_at([{"completed": True}]) is None
    assert is_past_week_flip([{"completed": True}], datetime(2026, 9, 22, tzinfo=timezone.utc))
