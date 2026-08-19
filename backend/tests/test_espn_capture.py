from app.providers.espn.capture import REDACTED, compare_shape, redact_captured_request


def test_redacts_cookie_header():
    raw = {
        "method": "POST",
        "url": "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/123/roster/",
        "headers": {"Cookie": "espn_s2=abc123; SWID={real-swid}", "Content-Type": "application/json"},
        "cookies": {"espn_s2": "abc123", "SWID": "{real-swid}"},
        "body": {"someKey": "someValue"},
    }
    redacted = redact_captured_request(raw)

    assert redacted["headers"]["Cookie"] == REDACTED
    assert redacted["headers"]["Content-Type"] == "application/json"  # not sensitive, left alone
    assert redacted["cookies"]["espn_s2"] == REDACTED
    assert redacted["cookies"]["SWID"] == REDACTED


def test_redacts_authorization_header():
    raw = {"method": "POST", "url": "https://example.com", "headers": {"Authorization": "Bearer topsecret"}}
    redacted = redact_captured_request(raw)
    assert redacted["headers"]["Authorization"] == REDACTED


def test_does_not_mutate_original_dict():
    raw = {"headers": {"Cookie": "secret"}}
    redact_captured_request(raw)
    assert raw["headers"]["Cookie"] == "secret"


def test_compare_shape_flags_host_and_method_mismatch():
    captured = {"method": "PUT", "url": "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/..."}
    result = compare_shape(
        captured,
        assumed_method="POST",
        assumed_url="https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/...",
    )
    assert result["method_matches"] is False
    assert result["host_matches"] is False


def test_compare_shape_matches_when_consistent():
    captured = {"method": "POST", "url": "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/roster/"}
    result = compare_shape(
        captured,
        assumed_method="POST",
        assumed_url="https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/roster/",
    )
    assert result["method_matches"] is True
    assert result["host_matches"] is True
