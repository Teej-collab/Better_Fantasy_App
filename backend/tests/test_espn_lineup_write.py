"""
Tests for the write path in app/providers/espn/lineup_client.py. Per
Phase 10 of the original request, NONE of these ever call the real
ESPN write endpoint — requests.post is always mocked. The single-item
request shape asserted here (URL, headers, body) is the VERIFIED shape
from the 2026-08-19 capture — see ESPN_LINEUP_WRITE.md; if this test's
expected body ever needs to change, that verification needs revisiting
first, not just the test.
"""
import requests

from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.lineup_exceptions import (
    ESPNWriteHTTPError,
    ESPNWriteMalformedResponseError,
    ESPNWriteTimeoutError,
    MutationVerificationFailedError,
    WriteNotVerifiedError,
)
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, text=""):
        self.status_code = status_code
        self._json_body = json_body
        self.text = text if text else (str(json_body) if json_body is not None else "")

    def json(self):
        if self._json_body is None:
            raise ValueError("no JSON body")
        return self._json_body


def _client_with_open_slot_roster(monkeypatch, dry_run=False):
    bench_rb = make_fake_lineup_player(4432665, "Bench RB", "BE", ["RB", "BE", "IR"])
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=[bench_rb])
    league = FakeLeague(teams=[team], current_week=5, position_slot_counts={"RB": 2, "BE": 6})
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)

    from app.providers.espn.config import ESPNConfig

    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "s2-secret-value")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", "2026")
    config = ESPNConfig()
    config.dry_run = dry_run

    client = ESPNLineupClient(config)
    return client, bench_rb


def test_single_item_write_sends_the_verified_request_shape(monkeypatch):
    client, bench_rb = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    captured_calls = []

    def fake_post(url, params=None, json=None, headers=None, cookies=None, timeout=None):
        captured_calls.append(
            {"url": url, "params": params, "json": json, "headers": headers, "cookies": cookies, "timeout": timeout}
        )
        bench_rb.lineupSlot = "RB"  # simulate ESPN actually applying it
        return _FakeResponse(200, {"status": "EXECUTED"})

    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", fake_post)

    result = client.set_lineup(4, "Bench RB", "RB")

    assert result.attempted is True
    assert result.dry_run is False
    assert result.verified is True

    assert len(captured_calls) == 1
    call = captured_calls[0]
    assert call["url"] == (
        "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/"
        "seasons/2026/segments/0/leagues/2027626914/transactions/"
    )
    assert call["params"] == {"platformVersion": "5e254affd13eaa961c7dffbd9de59d867a2e0acf"}
    assert call["json"] == {
        "isLeagueManager": False,
        "teamId": 4,
        "type": "ROSTER",
        "memberId": "{00000000-FAKE-0000-FAKE-000000000000}",
        "executionType": "EXECUTE",
        "items": [
            {"playerId": 4432665, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 2}
        ],
    }
    assert call["headers"]["Content-Type"] == "application/json"
    assert call["cookies"] == {"espn_s2": "s2-secret-value", "SWID": "{00000000-FAKE-0000-FAKE-000000000000}"}


def test_dry_run_still_default_and_never_calls_requests_post(monkeypatch):
    client, _ = _client_with_open_slot_roster(monkeypatch, dry_run=True)
    calls = []
    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", lambda *a, **k: calls.append(1))

    result = client.set_lineup(4, "Bench RB", "RB")
    assert result.dry_run is True
    assert calls == []


def test_verification_failure_when_roster_does_not_reflect_change(monkeypatch):
    client, bench_rb = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    # ESPN says EXECUTED but the roster (deliberately, for this test)
    # never actually changes — must not be reported as success.
    monkeypatch.setattr(
        "app.providers.espn.lineup_client.requests.post",
        lambda *a, **k: _FakeResponse(200, {"status": "EXECUTED"}),
    )
    try:
        client.set_lineup(4, "Bench RB", "RB")
        assert False, "expected MutationVerificationFailedError"
    except MutationVerificationFailedError:
        pass


def test_http_error_status_raises(monkeypatch):
    client, _ = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    monkeypatch.setattr(
        "app.providers.espn.lineup_client.requests.post",
        lambda *a, **k: _FakeResponse(403, text="Forbidden"),
    )
    try:
        client.set_lineup(4, "Bench RB", "RB")
        assert False, "expected ESPNWriteHTTPError"
    except ESPNWriteHTTPError as e:
        assert e.status_code == 403


def test_malformed_json_response_raises(monkeypatch):
    client, _ = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    monkeypatch.setattr(
        "app.providers.espn.lineup_client.requests.post",
        lambda *a, **k: _FakeResponse(200, json_body=None),
    )
    try:
        client.set_lineup(4, "Bench RB", "RB")
        assert False, "expected ESPNWriteMalformedResponseError"
    except ESPNWriteMalformedResponseError:
        pass


def test_timeout_raises_and_does_not_retry(monkeypatch):
    client, _ = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    call_count = []

    def fake_post(*a, **k):
        call_count.append(1)
        raise requests.exceptions.Timeout("timed out")

    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", fake_post)
    try:
        client.set_lineup(4, "Bench RB", "RB")
        assert False, "expected ESPNWriteTimeoutError"
    except ESPNWriteTimeoutError:
        pass
    assert len(call_count) == 1  # exactly once — no automatic retry


def test_multi_item_swap_is_blocked_even_with_dry_run_off(monkeypatch):
    starter = make_fake_lineup_player(1, "Starter RB", "RB", ["RB", "BE"])
    bencher = make_fake_lineup_player(2, "Bench RB", "BE", ["RB", "BE"])
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=[starter, bencher])
    league = FakeLeague(teams=[team], current_week=5)
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)

    from app.providers.espn.config import ESPNConfig

    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "s2-secret-value")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", "2026")
    config = ESPNConfig()
    config.dry_run = False
    client = ESPNLineupClient(config)

    calls = []
    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", lambda *a, **k: calls.append(1))

    try:
        client.swap_players(4, "Starter RB", "Bench RB")
        assert False, "expected WriteNotVerifiedError"
    except WriteNotVerifiedError:
        pass
    assert calls == []  # never actually sent — unverified 2-item shape


def test_error_message_redacts_credentials(monkeypatch):
    client, _ = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    monkeypatch.setattr(
        "app.providers.espn.lineup_client.requests.post",
        lambda *a, **k: _FakeResponse(
            500, text="error for member {00000000-FAKE-0000-FAKE-000000000000} with s2 s2-secret-value"
        ),
    )
    try:
        client.set_lineup(4, "Bench RB", "RB")
        assert False, "expected ESPNWriteHTTPError"
    except ESPNWriteHTTPError as e:
        assert "00000000-FAKE" not in str(e)
        assert "s2-secret-value" not in str(e)
