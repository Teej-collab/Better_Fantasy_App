"""
app/gamecast/providers/espn.py against realistic (hand-trimmed, but
schema-accurate) fixtures of ESPN's real public scoreboard/summary
responses — verified against a real completed 2026 preseason game
(Raiders @ Texans, event 401873286) before writing these down. No real
network calls: httpx.AsyncClient.get is monkeypatched per test.
"""
import httpx

from app.gamecast.models import GameStatus
from app.gamecast.providers.espn import ESPNNFLDataProvider

SCOREBOARD_FIXTURE = {
    "season": {"year": 2026, "type": 1},
    "week": {"number": 3},
    "events": [
        {
            "id": "401873286",
            "date": "2026-08-21T00:00Z",
            "competitions": [
                {
                    "competitors": [
                        {"homeAway": "home", "score": "20", "team": {"abbreviation": "HOU", "displayName": "Houston Texans"}},
                        {"homeAway": "away", "score": "22", "team": {"abbreviation": "LV", "displayName": "Las Vegas Raiders"}},
                    ],
                    "status": {
                        "period": 4,
                        "displayClock": "0:00",
                        "type": {"name": "STATUS_FINAL", "state": "post", "completed": True, "shortDetail": "Final"},
                    },
                }
            ],
        }
    ],
}

SUMMARY_FIXTURE = {
    "header": {
        "season": {"year": 2026},
        "week": 3,
        "competitions": [
            {
                "date": "2026-08-21T00:00Z",
                "competitors": [
                    {"id": "34", "homeAway": "home", "score": "20", "team": {"abbreviation": "HOU", "displayName": "Houston Texans"}},
                    {"id": "13", "homeAway": "away", "score": "22", "team": {"abbreviation": "LV", "displayName": "Las Vegas Raiders"}},
                ],
                "status": {
                    "period": 4,
                    "displayClock": "0:00",
                    "type": {"name": "STATUS_FINAL", "state": "post", "completed": True, "shortDetail": "Final"},
                },
            }
        ],
    },
    "drives": {
        "previous": [
            {
                "id": "1",
                "team": {"abbreviation": "HOU"},
                "start": {"yardLine": 31},
                "timeElapsed": {"displayValue": "4:54"},
                "offensivePlays": 2,
                "yards": 29,
                "result": "TD",
                "plays": [
                    {
                        "id": "p1",
                        "type": {"text": "Rush"},
                        "text": "W.Marks right guard to HST 40 for 9 yards.",
                        "period": {"number": 1},
                        "clock": {"displayValue": "14:00"},
                        "scoringPlay": False,
                        "isTurnover": False,
                        "statYardage": 9,
                        "start": {"down": 1, "distance": 10, "yardsToEndzone": 69},
                        "end": {"down": 2, "distance": 1, "yardsToEndzone": 60, "possessionText": "HOU 40"},
                    },
                    {
                        "id": "p2",
                        "type": {"text": "Rushing Touchdown"},
                        "text": "W.Marks 20 Yd Run (Kick).",
                        "period": {"number": 1},
                        "clock": {"displayValue": "10:06"},
                        "scoringPlay": True,
                        "isTurnover": False,
                        "statYardage": 20,
                        "start": {"down": 2, "distance": 1, "yardsToEndzone": 20},
                        "end": {"down": None, "distance": None, "yardsToEndzone": 0},
                    },
                ],
            }
        ]
    },
    "scoringPlays": [
        {
            "id": "sp1",
            "type": {"abbreviation": "TD", "text": "Rushing Touchdown"},
            "text": "Woody Marks 20 Yd Run (Ka'imi Fairbairn Kick).",
            "period": {"number": 1},
            "clock": {"displayValue": "10:06"},
            "team": {"abbreviation": "HOU"},
            "homeScore": 7,
            "awayScore": 0,
        }
    ],
}


def _fake_get(scoreboard=SCOREBOARD_FIXTURE, summary=SUMMARY_FIXTURE, summary_status=200):
    class _FakeResponse:
        def __init__(self, json_data, status_code):
            self._json = json_data
            self.status_code = status_code

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("error", request=None, response=self)  # type: ignore[arg-type]

        def json(self):
            return self._json

    async def get(self, url, params=None, **kwargs):
        if "summary" in url:
            return _FakeResponse(summary, summary_status)
        return _FakeResponse(scoreboard, 200)

    return get


async def test_list_live_games_parses_the_real_scoreboard_shape(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get())
    provider = ESPNNFLDataProvider()

    games = await provider.list_live_games()

    assert len(games) == 1
    g = games[0]
    assert g.game_id == "401873286"
    assert g.provider == "espn"
    assert g.season == 2026
    assert g.week == 3
    assert g.status == GameStatus.FINAL
    assert g.home_team.abbr == "HOU" and g.home_team.score == 20
    assert g.away_team.abbr == "LV" and g.away_team.score == 22


async def test_get_game_state_parses_drives_plays_and_scoring_plays(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get())
    provider = ESPNNFLDataProvider()

    game = await provider.get_game_state("401873286")

    assert game.game_id == "401873286"
    assert game.status == GameStatus.FINAL
    assert game.clock == "Final"
    assert game.home_team.score == 20 and game.away_team.score == 22

    # A finished game has no "current" drive/down/distance/possession —
    # there's nothing still in progress to report.
    assert game.current_drive is None
    assert game.down is None
    assert game.possession_team_abbr is None

    assert len(game.drives) == 1
    assert game.drives[0].team_abbr == "HOU"
    assert game.drives[0].result == "TD"
    assert game.drives[0].play_count == 2

    # Most-recent-first, matching the mock provider's own convention.
    assert len(game.plays) == 2
    assert game.plays[0].description.startswith("W.Marks 20 Yd Run")
    assert game.plays[0].is_scoring_play is True
    assert game.plays[0].play_type == "rush"
    assert game.plays[1].down == 1 and game.plays[1].distance == 10

    assert len(game.scoring_plays) == 1
    sp = game.scoring_plays[0]
    assert sp.team_abbr == "HOU"
    assert sp.score_type == "TD"
    assert sp.home_score_after == 7 and sp.away_score_after == 0


async def test_get_game_state_raises_key_error_for_an_unknown_game(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get(summary_status=404))
    provider = ESPNNFLDataProvider()

    try:
        await provider.get_game_state("does-not-exist")
        assert False, "expected KeyError"
    except KeyError:
        pass


async def test_list_live_games_never_raises_when_a_game_is_missing_a_competitor(monkeypatch):
    broken_scoreboard = {
        "season": {"year": 2026},
        "week": {"number": 3},
        "events": [{"id": "1", "date": "2026-08-21T00:00Z", "competitions": [{"competitors": [{"homeAway": "home"}]}]}],
    }
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get(scoreboard=broken_scoreboard))
    provider = ESPNNFLDataProvider()

    games = await provider.list_live_games()

    assert games == []
