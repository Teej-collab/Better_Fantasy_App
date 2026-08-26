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


# ---- team D/ST tests --------------------------------------------------------
# Fixture shaped from two real verified captures (SCORING_ENGINE_SOURCE.md):
# header.competitions[0].competitors[].score, and
# boxscore.teams[].statistics[name="totalYards"].displayValue.

_FAKE_DST_SUMMARY = {
    "header": {
        "competitions": [
            {
                "competitors": [
                    {"homeAway": "home", "team": {"abbreviation": "HOU"}, "score": "20"},
                    {"homeAway": "away", "team": {"abbreviation": "LV"}, "score": "22"},
                ]
            }
        ]
    },
    "boxscore": {
        "teams": [
            {"team": {"abbreviation": "HOU"}, "homeAway": "home",
             "statistics": [{"name": "totalYards", "displayValue": "310"}]},
            {"team": {"abbreviation": "LV"}, "homeAway": "away",
             "statistics": [{"name": "totalYards", "displayValue": "400"}]},
        ],
        "players": [
            {
                "team": {"abbreviation": "HOU"},
                "statistics": [
                    {"name": "defensive", "keys": ["sacks", "defensiveTouchdowns"],
                     "athletes": [{"athlete": {"id": "1"}, "stats": ["2", "0"]}]},
                    {"name": "interceptions", "keys": ["interceptions", "interceptionTouchdowns"],
                     "athletes": [{"athlete": {"id": "2"}, "stats": ["1", "0"]}]},
                    {"name": "fumbles", "keys": ["fumbles", "fumblesLost", "fumblesRecovered"],
                     "athletes": [{"athlete": {"id": "3"}, "stats": ["0", "0", "1"]}]},
                ],
            },
            {
                "team": {"abbreviation": "LV"},
                "statistics": [
                    {"name": "defensive", "keys": ["sacks", "defensiveTouchdowns"],
                     "athletes": [{"athlete": {"id": "4"}, "stats": ["1", "0"]}]},
                    {"name": "kickReturns", "keys": ["kickReturns", "kickReturnTouchdowns"],
                     "athletes": [{"athlete": {"id": "5"}, "stats": ["3", "1"]}]},
                ],
            },
        ],
    },
}


def test_parse_team_dst_stats_points_and_yards_allowed_use_the_opponent():
    stat_lines = espn_public.parse_team_dst_stats(_FAKE_DST_SUMMARY)

    # HOU allowed LV's score (22, tier 18-27) and LV's yards (400, tier 400-449).
    assert stat_lines["HOU"]["pts_allow_18_27"] == 1
    assert stat_lines["HOU"]["yds_allow_400_449"] == 1
    # LV allowed HOU's score (20, tier 18-27) and HOU's yards (310, tier 300-349).
    assert stat_lines["LV"]["pts_allow_18_27"] == 1
    assert stat_lines["LV"]["yds_allow_300_349"] == 1


def test_parse_team_dst_stats_aggregates_defensive_plays_per_team():
    stat_lines = espn_public.parse_team_dst_stats(_FAKE_DST_SUMMARY)

    assert stat_lines["HOU"]["def_sack"] == 2
    assert stat_lines["HOU"]["def_int"] == 1
    assert stat_lines["HOU"]["def_fum_rec"] == 1
    assert stat_lines["LV"]["def_sack"] == 1


def test_parse_team_dst_stats_return_td_credits_the_team_too():
    # LV's kick returner scored a return TD — this league's own scoring
    # credits both the individual returner (ret_td) and the team D/ST
    # (def_return_td) for the same play.
    stat_lines = espn_public.parse_team_dst_stats(_FAKE_DST_SUMMARY)
    assert stat_lines["LV"]["def_return_td"] == 1


async def test_get_game_stats_returns_both_players_and_team_dst(monkeypatch):
    class _FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return _FAKE_DST_SUMMARY

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None):
            return _FakeResponse()

    monkeypatch.setattr(espn_public.httpx, "AsyncClient", _FakeClient)

    result = await espn_public.get_game_stats("401873286")
    assert "players" in result and "team_dst" in result
    assert result["team_dst"]["HOU"]["def_sack"] == 2
