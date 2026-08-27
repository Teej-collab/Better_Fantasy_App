"""Never hits real ESPN — League is monkeypatched with FakeLeague, same
principle as test_free_agents.py. Confirms the bye-week/next-opponent
derivation, which was actually wrong on the first live check this
session (schedule dict keys came back as strings, not ints — see
player_info.py's docstring) before being fixed and re-verified live."""
from app.providers.espn import player_info
from app.providers.espn.config import ESPNConfig
from tests.fakes_espn import FakeLeague, make_fake_player_card_player

_FULL_SEASON_SCHEDULE_MINUS_WEEK_13 = {
    str(week): {"team": "OPP", "date": None} for week in range(1, 19) if week != 13
}


def _set_espn_env(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", "2026")


def _patch_league(monkeypatch, league):
    monkeypatch.setattr(player_info, "League", lambda **kwargs: league)
    # _get_league caches by (league_id, year) across calls (see its own
    # docstring) — every test here reuses the same fake league_id/season,
    # so the module-level cache must be cleared per test or a later test
    # would silently get an earlier test's fake League back.
    monkeypatch.setattr(player_info, "_league_cache", {})


async def test_get_player_info_derives_bye_week_from_missing_string_key(monkeypatch):
    _set_espn_env(monkeypatch)
    player = make_fake_player_card_player(
        4242335, projected_total_points=316.51, percent_owned=99.84,
        schedule=_FULL_SEASON_SCHEDULE_MINUS_WEEK_13,
    )
    _patch_league(monkeypatch, FakeLeague(current_week=1, player_info_by_id={4242335: player}))

    result = player_info.get_player_info(4242335)

    assert result["bye_week"] == 13
    assert result["season_projected_points"] == 316.51
    assert result["percent_owned"] == 99.84
    assert result["espn_player_id"] == 4242335


async def test_get_player_info_next_opponent_from_current_week(monkeypatch):
    _set_espn_env(monkeypatch)
    schedule = {**_FULL_SEASON_SCHEDULE_MINUS_WEEK_13, "5": {"team": "BAL", "date": None}}
    player = make_fake_player_card_player(4242335, schedule=schedule)
    _patch_league(monkeypatch, FakeLeague(current_week=5, player_info_by_id={4242335: player}))

    result = player_info.get_player_info(4242335)

    assert result["next_opponent"] == "BAL"
    assert result["current_week"] == 5


async def test_get_player_info_falls_back_to_week_1_during_preseason(monkeypatch):
    _set_espn_env(monkeypatch)
    schedule = {**_FULL_SEASON_SCHEDULE_MINUS_WEEK_13, "1": {"team": "BAL", "date": None}}
    player = make_fake_player_card_player(4242335, schedule=schedule)
    # league.current_week is 0 during the preseason — confirmed live, see module docstring.
    _patch_league(monkeypatch, FakeLeague(current_week=0, player_info_by_id={4242335: player}))

    result = player_info.get_player_info(4242335)

    assert result["current_week"] == 1
    assert result["next_opponent"] == "BAL"


async def test_get_player_info_returns_none_for_unmapped_id(monkeypatch):
    _set_espn_env(monkeypatch)
    _patch_league(monkeypatch, FakeLeague(current_week=1, player_info_by_id={}))

    assert player_info.get_player_info(999999) is None


async def test_get_player_info_falls_back_to_name_lookup_when_id_missing(monkeypatch):
    _set_espn_env(monkeypatch)
    player = make_fake_player_card_player(4242335, schedule=_FULL_SEASON_SCHEDULE_MINUS_WEEK_13)
    _patch_league(monkeypatch, FakeLeague(
        current_week=1,
        player_info_by_id={4242335: player},
        player_map={"Jonathan Taylor": 4242335},
    ))

    result = player_info.get_player_info(None, full_name="Jonathan Taylor")

    assert result["espn_player_id"] == 4242335
    assert result["bye_week"] == 13


async def test_get_player_info_returns_none_when_name_has_no_match(monkeypatch):
    _set_espn_env(monkeypatch)
    _patch_league(monkeypatch, FakeLeague(current_week=1, player_map={}))

    assert player_info.get_player_info(None, full_name="Totally Unknown Guy") is None


async def test_get_league_reuses_cached_league_within_ttl(monkeypatch):
    _set_espn_env(monkeypatch)
    build_calls = []

    def _fake_league_ctor(**kwargs):
        build_calls.append(kwargs)
        return FakeLeague(current_week=1)

    monkeypatch.setattr(player_info, "League", _fake_league_ctor)
    monkeypatch.setattr(player_info, "_league_cache", {})

    config = ESPNConfig()
    player_info._get_league(config, None)
    player_info._get_league(config, None)

    assert len(build_calls) == 1  # second call served from cache, no second real fetch
