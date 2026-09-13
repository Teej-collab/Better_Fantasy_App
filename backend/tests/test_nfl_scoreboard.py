"""Never hits the real ESPN scoreboard endpoint in tests — httpx.AsyncClient
is replaced with a fake that returns a canned response, same principle
as the ESPN lineup-write tests never sending a real request."""
from app.providers.nfl_scoreboard import get_nfl_scoreboard, get_real_current_week, get_week_scoreboard, is_nfl_game_live


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

    async def get(self, url, params=None):
        self.last_params = params
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
    # This fixture's game is already final and never carried a
    # "situation" object at all — both should read as "nothing live"
    # rather than crash on a missing key.
    assert game["possession_team_abbr"] is None
    assert game["is_redzone"] is False


_LIVE_FAKE_RESPONSE = {
    "events": [
        {
            "id": "500",
            "name": "Chicago Bears at Carolina Panthers",
            "competitions": [
                {
                    "status": {"type": {"state": "in", "completed": False, "shortDetail": "11:33 - 1st"}},
                    "competitors": [
                        {"homeAway": "home", "score": "0", "team": {"id": "29", "abbreviation": "CAR"}},
                        {"homeAway": "away", "score": "7", "team": {"id": "3", "abbreviation": "CHI"}},
                    ],
                    # Real shape from ESPN's own scoreboard endpoint —
                    # possession is a team id, not an abbreviation.
                    "situation": {"possession": "3", "isRedZone": False},
                }
            ],
        }
    ]
}


class _FakeLiveAsyncClient(_FakeAsyncClient):
    async def get(self, url, params=None):
        self.last_params = params
        return _FakeResponse(_LIVE_FAKE_RESPONSE)


async def test_parses_possession_and_redzone_from_a_real_live_game(monkeypatch):
    # The exact real-world case this was added for, 2026-09-13: CHI@CAR
    # genuinely in progress, CHI has the ball, resolved from a team id
    # against these same two competitors' own team.id — not a separate
    # id->abbreviation table.
    monkeypatch.setattr("app.providers.nfl_scoreboard.httpx.AsyncClient", _FakeLiveAsyncClient)

    games = await get_nfl_scoreboard()

    assert len(games) == 1
    game = games[0]
    assert game["state"] == "in"
    assert game["possession_team_abbr"] == "CHI"
    assert game["is_redzone"] is False


async def test_get_week_scoreboard_passes_week_params_and_parses_same_shape(monkeypatch):
    captured = {}

    class _CapturingClient(_FakeAsyncClient):
        async def get(self, url, params=None):
            captured["url"] = url
            captured["params"] = params
            return _FakeResponse(_FAKE_RESPONSE)

    monkeypatch.setattr("app.providers.nfl_scoreboard.httpx.AsyncClient", _CapturingClient)

    games = await get_week_scoreboard(week=3, year=2026, season_type=1)

    assert captured["params"] == {"week": 3, "seasontype": 1, "dates": 2026}
    assert len(games) == 1
    assert games[0]["home_team"] == "CIN"


async def test_get_week_scoreboard_defaults_to_regular_season(monkeypatch):
    captured = {}

    class _CapturingClient(_FakeAsyncClient):
        async def get(self, url, params=None):
            captured["params"] = params
            return _FakeResponse(_FAKE_RESPONSE)

    monkeypatch.setattr("app.providers.nfl_scoreboard.httpx.AsyncClient", _CapturingClient)

    await get_week_scoreboard(week=5, year=2026)

    assert captured["params"]["seasontype"] == 2


async def test_get_real_current_week_reads_top_level_week_number(monkeypatch):
    class _CurrentWeekClient(_FakeAsyncClient):
        async def get(self, url, params=None):
            return _FakeResponse({"week": {"number": 3}, "season": {"type": 2, "year": 2026}})

    monkeypatch.setattr("app.providers.nfl_scoreboard.httpx.AsyncClient", _CurrentWeekClient)

    assert await get_real_current_week() == 3


async def test_get_real_current_week_none_outside_regular_season(monkeypatch):
    class _PreseasonClient(_FakeAsyncClient):
        async def get(self, url, params=None):
            return _FakeResponse({"week": {"number": 3}, "season": {"type": 1, "year": 2026}})

    monkeypatch.setattr("app.providers.nfl_scoreboard.httpx.AsyncClient", _PreseasonClient)

    assert await get_real_current_week() is None
