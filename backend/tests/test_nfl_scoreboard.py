"""Never hits the real ESPN scoreboard endpoint in tests — httpx.AsyncClient
is replaced with a fake that returns a canned response, same principle
as the ESPN lineup-write tests never sending a real request."""
from app.providers.nfl_scoreboard import get_nfl_scoreboard, is_nfl_game_live


def test_is_nfl_game_live_true_when_any_game_in_progress():
    games = [{"state": "pre"}, {"state": "in"}, {"state": "post"}]
    assert is_nfl_game_live(games) is True


def test_is_nfl_game_live_false_when_nothing_in_progress():
    assert is_nfl_game_live([{"state": "pre"}, {"state": "post"}]) is False


def test_is_nfl_game_live_false_with_no_games():
    assert is_nfl_game_live([]) is False

_FAKE_RESPONSE = {
    "events": [
        {
            "id": "401",
            "name": "Detroit Lions at Cincinnati Bengals",
            "competitions": [
                {
                    "status": {
                        "type": {
                            "state": "post",
                            "completed": True,
                            "shortDetail": "Final",
                        }
                    },
                    "competitors": [
                        {"homeAway": "home", "score": "16", "team": {"abbreviation": "CIN"}},
                        {"homeAway": "away", "score": "14", "team": {"abbreviation": "DET"}},
                    ],
                }
            ],
        },
        # Malformed entry (no competitions) — must be skipped, not crash.
        {"id": "402", "name": "Bad Event", "competitions": []},
    ]
}


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url):
        return _FakeResponse(_FAKE_RESPONSE)


async def test_parses_real_shaped_scoreboard_response(monkeypatch):
    monkeypatch.setattr("app.providers.nfl_scoreboard.httpx.AsyncClient", _FakeAsyncClient)

    games = await get_nfl_scoreboard()

    assert len(games) == 1  # the malformed entry was skipped
    game = games[0]
    assert game["home_team"] == "CIN"
    assert game["home_score"] == "16"
    assert game["away_team"] == "DET"
    assert game["away_score"] == "14"
    assert game["state"] == "post"
    assert game["completed"] is True
    assert game["status_detail"] == "Final"
