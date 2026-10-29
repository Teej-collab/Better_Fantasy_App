from datetime import datetime, timezone

from app.providers.game_wind import wind_at

HOURLY = {
    "time": ["2026-11-01T17:00", "2026-11-01T18:00", "2026-11-01T19:00"],
    "wind_speed_10m": [9.6, 14.4, 18.2],
    "wind_gusts_10m": [15.0, 23.1, None],
    "wind_direction_10m": [90, 92, 101],
}


def test_reads_the_kickoff_hour():
    kickoff = datetime(2026, 11, 1, 18, 0, tzinfo=timezone.utc)
    assert wind_at(HOURLY, kickoff) == {"wind_mph": 14, "wind_gust_mph": 23, "wind_dir": 92}


def test_rounds_to_the_nearest_hour():
    # A 6:25 kickoff reads 18:00, a 6:40 one 19:00 (no gust that hour).
    assert wind_at(HOURLY, datetime(2026, 11, 1, 18, 25, tzinfo=timezone.utc))["wind_mph"] == 14
    assert wind_at(HOURLY, datetime(2026, 11, 1, 18, 40, tzinfo=timezone.utc)) == {"wind_mph": 18, "wind_gust_mph": None, "wind_dir": 101}


def test_beyond_the_forecast_is_none():
    assert wind_at(HOURLY, datetime(2026, 11, 9, 18, 0, tzinfo=timezone.utc)) is None
