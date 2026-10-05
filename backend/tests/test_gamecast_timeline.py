"""The rolling game history a Lounge room delays its TV's game with
(app/gamecast/service.py's _record_history / timeline)."""
from app.gamecast import service
from app.gamecast.models import LiveGame


def _game(score: int, clock: str = "10:00") -> LiveGame:
    return LiveGame.model_validate({
        "game_id": "999001", "provider": "espn", "status": "in_progress", "season": 2026, "week": 5,
        "scheduled_start": "2026-10-11T17:00:00Z",
        "home_team": {"abbr": "KC", "name": "Chiefs", "score": score},
        "away_team": {"abbr": "LV", "name": "Raiders", "score": 0},
        "period": 2, "clock": clock, "is_redzone": False, "drives": [], "plays": [], "scoring_plays": [],
        "last_updated": "2026-10-11T17:30:00Z",
    })


def test_history_records_only_real_changes_and_ages_out():
    service._history.pop("999001", None)
    service._record_history(_game(0), now=1000.0)
    service._record_history(_game(0), now=1010.0)  # nothing changed — not a new snapshot
    service._record_history(_game(7), now=1020.0)
    snaps = service.timeline("999001")
    assert [s["at"] for s in snaps] == [1000.0, 1020.0]
    assert snaps[-1]["game"]["home_team"]["score"] == 7

    later = 1020.0 + service.HISTORY_SECONDS - 10  # 1000.0 is now past the window, 1020.0 isn't
    service._record_history(_game(7, "9:00"), now=later)
    assert [s["at"] for s in service.timeline("999001")] == [1020.0, later]
    service._history.pop("999001", None)
