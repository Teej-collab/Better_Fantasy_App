"""Never hits the real ESPN summary endpoint — httpx.AsyncClient is
replaced with a fake returning a canned response shaped like the real
capture documented in SCORING_ENGINE_SOURCE.md (verified 2026-08-26
against a real completed game), same principle as
test_nfl_scoreboard.py's own fake."""
from app.providers.nfl_stats import espn_public

_FAKE_SUMMARY = {
    "boxscore": {
        "players": [
            {
                "team": {"abbreviation": "LV"},
                "statistics": [
                    {
                        "name": "passing",
                        "keys": ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt",
                                 "passingTouchdowns", "interceptions"],
                        "athletes": [
                            {
                                "athlete": {"id": "4260394", "displayName": "Aidan O'Connell"},
                                "stats": ["15/24", "166", "6.9", "2", "1"],
                            }
                        ],
                    },
                    {
                        "name": "rushing",
                        "keys": ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns"],
                        "athletes": [
                            {
                                # Same QB also ran for a TD — must merge into the same entry, not duplicate.
                                "athlete": {"id": "4260394", "displayName": "Aidan O'Connell"},
                                "stats": ["3", "12", "4.0", "1"],
                            }
                        ],
                    },
                    {
                        "name": "receiving",
                        "keys": ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns",
                                 "longReception", "receivingTargets"],
                        "athletes": [
                            {
                                "athlete": {"id": "4035198", "displayName": "Brandon Johnson"},
                                "stats": ["2", "41", "20.5", "0", "33", "3"],
                            }
                        ],
                    },
                    {
                        "name": "kicking",
                        "keys": ["fieldGoalsMade/fieldGoalAttempts", "fieldGoalPct", "longFieldGoalMade",
                                 "extraPointsMade/extraPointAttempts", "totalKickingPoints"],
                        "athletes": [
                            {
                                "athlete": {"id": "9999", "displayName": "Test Kicker"},
                                "stats": ["2/3", "66.7", "45", "3/3", "9"],
                            }
                        ],
                    },
                ],
            }
        ]
    }
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
        return _FakeResponse(_FAKE_SUMMARY)


async def test_get_game_player_stats_maps_verified_categories(monkeypatch):
    monkeypatch.setattr(espn_public.httpx, "AsyncClient", _FakeAsyncClient)

    players = await espn_public.get_game_player_stats("401873286")
    by_id = {p["espn_player_id"]: p for p in players}

    assert set(by_id.keys()) == {4260394, 4035198, 9999}


async def test_a_player_appearing_in_multiple_categories_is_merged_not_duplicated(monkeypatch):
    monkeypatch.setattr(espn_public.httpx, "AsyncClient", _FakeAsyncClient)

    players = await espn_public.get_game_player_stats("401873286")
    qb = next(p for p in players if p["espn_player_id"] == 4260394)

    assert qb["player_name"] == "Aidan O'Connell"
    assert qb["pro_team"] == "LV"
    assert qb["stat_line"] == {
        "pass_yd": 166.0, "pass_td": 2.0, "pass_int": 1.0,
        "rush_yd": 12.0, "rush_td": 1.0,
    }


async def test_receiving_stat_line(monkeypatch):
    monkeypatch.setattr(espn_public.httpx, "AsyncClient", _FakeAsyncClient)

    players = await espn_public.get_game_player_stats("401873286")
    wr = next(p for p in players if p["espn_player_id"] == 4035198)

    assert wr["stat_line"] == {"rec": 2.0, "rec_yd": 41.0, "rec_td": 0.0}


async def test_extra_points_made_parsed_from_made_over_attempted_string(monkeypatch):
    monkeypatch.setattr(espn_public.httpx, "AsyncClient", _FakeAsyncClient)

    players = await espn_public.get_game_player_stats("401873286")
    kicker = next(p for p in players if p["espn_player_id"] == 9999)

    # Field goals aren't mapped at all (deliberately — see module
    # docstring), only XP.
    assert kicker["stat_line"] == {"xp_made": 3.0}
