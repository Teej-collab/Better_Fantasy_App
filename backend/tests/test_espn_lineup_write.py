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


def test_swap_sends_the_verified_two_item_request_shape(monkeypatch):
    # Player IDs and slot IDs match a real captured two-player swap
    # (2026-08-19, see ESPN_LINEUP_WRITE.md): a bench player moved into
    # K (17), the starting kicker moved to BENCH (20) — confirmed as
    # exactly the mirrored 2-item shape this client already builds.
    bench_k = make_fake_lineup_player(2473037, "Bench Kicker", "BE", ["K", "BE"])
    starting_k = make_fake_lineup_player(3055899, "Starting Kicker", "K", ["K", "BE"])
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=[bench_k, starting_k])
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

    captured_calls = []

    def fake_post(url, params=None, json=None, headers=None, cookies=None, timeout=None):
        captured_calls.append({"url": url, "json": json})
        bench_k.lineupSlot = "K"  # simulate ESPN actually applying the swap
        starting_k.lineupSlot = "BE"
        return _FakeResponse(200, {"status": "EXECUTED"})

    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", fake_post)

    result = client.swap_players(4, "Bench Kicker", "Starting Kicker")

    assert result.attempted is True
    assert result.verified is True

    assert captured_calls[0]["json"]["items"] == [
        {"playerId": 2473037, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 17},
        {"playerId": 3055899, "type": "LINEUP", "fromLineupSlotId": 17, "toLineupSlotId": 20},
    ]


def test_displacement_sends_the_same_verified_two_item_shape(monkeypatch):
    # set_lineup() into a FULL slot goes through the same
    # _lineup_change_items mirroring as swap_players() — this confirms
    # that path sends too, using the swap capture's verified shape.
    starting_qb = make_fake_lineup_player(10, "Starting QB", "QB", ["QB", "BE"])
    bench_qb = make_fake_lineup_player(11, "Bench QB", "BE", ["QB", "BE"])
    team = make_fake_team(4, "Test Team", "test-member-1", "Alice", "Smith", roster=[starting_qb, bench_qb])
    league = FakeLeague(teams=[team], current_week=5, position_slot_counts={"QB": 1, "BE": 6})
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)

    from app.providers.espn.config import ESPNConfig

    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "s2-secret-value")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")
    monkeypatch.setenv("ACTIVE_SEASON", "2026")
    config = ESPNConfig()
    config.dry_run = False
    client = ESPNLineupClient(config)

    captured_calls = []

    def fake_post(url, params=None, json=None, headers=None, cookies=None, timeout=None):
        captured_calls.append({"json": json})
        bench_qb.lineupSlot = "QB"
        starting_qb.lineupSlot = "BE"
        return _FakeResponse(200, {"status": "EXECUTED"})

    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", fake_post)

    result = client.set_lineup(4, "Bench QB", "QB")

    assert result.attempted is True
    assert result.verified is True
    assert captured_calls[0]["json"]["items"] == [
        {"playerId": 11, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 0},
        {"playerId": 10, "type": "LINEUP", "fromLineupSlotId": 0, "toLineupSlotId": 20},
    ]


def test_more_than_two_items_still_blocked(monkeypatch):
    # Nothing in this client's planning logic produces a 3+ item
    # request today, so this exercises _send_mutation's guard directly
    # rather than through set_lineup()/swap_players().
    client, _ = _client_with_open_slot_roster(monkeypatch, dry_run=False)
    calls = []
    monkeypatch.setattr("app.providers.espn.lineup_client.requests.post", lambda *a, **k: calls.append(1))

    three_items = [
        {"playerId": 1, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 2},
        {"playerId": 2, "type": "LINEUP", "fromLineupSlotId": 2, "toLineupSlotId": 4},
        {"playerId": 3, "type": "LINEUP", "fromLineupSlotId": 4, "toLineupSlotId": 20},
    ]
    try:
        client._send_mutation(4, three_items, {1: 2, 2: 4, 3: 20}, None, "test 3-item mutation")
        assert False, "expected WriteNotVerifiedError"
    except WriteNotVerifiedError:
        pass
    assert calls == []


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
