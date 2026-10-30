"""bet_slip_reader's cheap-first read (2026-10-30): Haiku reads first,
Sonnet only reads again when Haiku's answer is missing something, and a
slip read once comes from the cache. No network, no database."""
import pytest

from app.providers import bet_slip_reader as reader


def _slip(**leg_overrides):
    leg = {"description": "Jahmyr Gibbs Over 79.5 Rushing Yards", "market": "player_prop", "player_name": "Jahmyr Gibbs",
           "team_abbr": "DET", "stat_key": "rush_yd", "line": 79.5, "direction": "over", "odds_american": -115}
    leg.update(leg_overrides)
    return {"is_bet_slip": True, "bets": [{"sportsbook": "DraftKings", "stake": 10, "odds_american": -115, "legs": [leg], "unclear": False}]}


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    monkeypatch.setattr(reader.config, "ANTHROPIC_API_KEY", "test-key")
    reader._cache.clear()
    yield
    reader._cache.clear()


def _fake_ask(answers, calls):
    def ask(model, content):
        calls.append(model)
        answer = answers[model]
        if isinstance(answer, Exception):
            raise answer
        return answer

    return ask


def test_a_complete_cheap_read_is_used_as_is(monkeypatch):
    calls = []
    monkeypatch.setattr(reader, "_ask", _fake_ask({reader.FIRST_MODEL: _slip()}, calls))
    assert reader.read_bet_page("Gibbs o79.5", "https://sportsbook.draftkings.com/x")["bets"][0]["legs"][0]["line"] == 79.5
    assert calls == [reader.FIRST_MODEL]


@pytest.mark.parametrize(
    "cheap",
    [
        _slip(player_name=None),
        _slip(stat_key=None),
        _slip(line=None),
        {"is_bet_slip": False, "bets": []},
        {"is_bet_slip": True, "bets": [{**_slip()["bets"][0], "unclear": True}]},
        {"is_bet_slip": True, "bets": [{**_slip()["bets"][0], "odds_american": None, "payout": None}]},
    ],
)
def test_a_cheap_read_missing_something_is_read_again(monkeypatch, cheap):
    calls = []
    monkeypatch.setattr(reader, "_ask", _fake_ask({reader.FIRST_MODEL: cheap, reader.MODEL: _slip()}, calls))
    assert reader.read_bet_slip("aGVsbG8=", "image/png") == _slip()
    assert calls == [reader.FIRST_MODEL, reader.MODEL]


def test_an_anytime_td_needs_no_line(monkeypatch):
    calls = []
    td = _slip(stat_key="anytime_td", line=None, direction="yes")
    monkeypatch.setattr(reader, "_ask", _fake_ask({reader.FIRST_MODEL: td}, calls))
    reader.read_bet_page("Gibbs anytime TD", "https://sportsbook.draftkings.com/y")
    assert calls == [reader.FIRST_MODEL]


def test_a_failed_cheap_read_falls_back(monkeypatch):
    calls = []
    monkeypatch.setattr(reader, "_ask", _fake_ask({reader.FIRST_MODEL: RuntimeError("no tool"), reader.MODEL: _slip()}, calls))
    assert reader.read_bet_page("text", "https://sportsbook.draftkings.com/z") == _slip()
    assert calls == [reader.FIRST_MODEL, reader.MODEL]


def test_the_same_slip_is_read_once(monkeypatch):
    calls = []
    monkeypatch.setattr(reader, "_ask", _fake_ask({reader.FIRST_MODEL: _slip()}, calls))
    first = reader.read_bet_page("same page", "https://sportsbook.draftkings.com/same")
    first["bets"][0]["stake"] = 999  # a caller editing its copy doesn't touch the cache
    second = reader.read_bet_page("same page", "https://sportsbook.draftkings.com/same")
    assert calls == [reader.FIRST_MODEL]
    assert second["bets"][0]["stake"] == 10
