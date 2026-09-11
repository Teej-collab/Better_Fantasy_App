import time

import jwt as pyjwt

from app.auth.session import (
    CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS,
    TICKET_MAX_AGE_SECONDS,
    create_session_token,
    decode_session_token,
    decode_ticket_token,
    get_session_token,
)

_SECRET = "test-secret-thats-at-least-32-bytes-long"


class _FakeRequest:
    """Minimal stand-in for a FastAPI/Starlette Request — get_session_token
    only ever calls .headers.get(...) and .cookies.get(...), so a plain
    dict-backed fake is enough to unit-test it without spinning up the
    app or a DB, matching this file's existing no-DB style."""

    def __init__(self, headers=None, cookies=None):
        self.headers = headers or {}
        self.cookies = cookies or {}


def test_get_session_token_prefers_bearer_header_over_cookie():
    req = _FakeRequest(headers={"authorization": "Bearer abc123"}, cookies={"session": "cookie-token"})
    assert get_session_token(req) == "abc123"


def test_get_session_token_falls_back_to_cookie_when_no_header():
    req = _FakeRequest(cookies={"session": "cookie-token"})
    assert get_session_token(req) == "cookie-token"


def test_get_session_token_ignores_non_bearer_authorization_header():
    req = _FakeRequest(headers={"authorization": "Basic somebase64"}, cookies={"session": "cookie-token"})
    assert get_session_token(req) == "cookie-token"


def test_get_session_token_returns_none_with_neither():
    assert get_session_token(_FakeRequest()) is None


def test_round_trip():
    token = create_session_token(
        "test-secret-thats-at-least-32-bytes-long", user_id=1, owner_id=2, discord_user_id=123456789, is_commissioner=True
    )
    payload = decode_session_token("test-secret-thats-at-least-32-bytes-long", token)
    assert payload["user_id"] == 1
    assert payload["owner_id"] == 2
    assert payload["discord_user_id"] == 123456789
    assert payload["is_commissioner"] is True


def test_wrong_secret_rejected():
    token = create_session_token(
        "correct-secret-thats-at-least-32-bytes-long", user_id=1, owner_id=2, discord_user_id=1, is_commissioner=False
    )
    assert decode_session_token("wrong-secret-thats-also-at-least-32-bytes", token) is None


def test_garbage_token_rejected():
    assert decode_session_token("test-secret-thats-at-least-32-bytes-long", "not-a-real-jwt") is None


def _ticket_minted_seconds_ago(purpose: str, max_age_seconds: int, seconds_ago: float) -> str:
    """Builds a ticket exactly as create_ticket_token would, but as if
    it had been minted `seconds_ago` in the past — constructed directly
    (not via create_ticket_token + mocking time.time()) since PyJWT's
    own expiration check reads real wall-clock time internally, not
    whatever the `time` module's `time.time` attribute currently points
    to, so monkeypatching that doesn't reach it. Backdating the `exp`
    claim itself exercises the real, unmocked PyJWT expiration check."""
    payload = {
        "user_id": 1, "owner_id": 2, "discord_user_id": 3, "is_commissioner": False,
        "purpose": purpose,
        "exp": int(time.time()) - seconds_ago + max_age_seconds,
    }
    return pyjwt.encode(payload, _SECRET, algorithm="HS256")


def test_a_ticket_past_its_own_expiry_is_rejected():
    """Sanity check on the expiry mechanism itself, before trusting the
    "survives 61s" test below to mean anything."""
    ticket = _ticket_minted_seconds_ago("chug_upload", CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS, seconds_ago=CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS + 5)
    assert decode_ticket_token(_SECRET, ticket, expected_purpose="chug_upload") is None


def test_ws_ticket_would_not_have_survived_61_seconds():
    """The exact bug, reproduced: a ticket minted with the short
    TICKET_MAX_AGE_SECONDS default (60s, meant for a quick WS
    handshake) genuinely does not survive to the 61-second mark a real
    production chug upload hit."""
    ticket = _ticket_minted_seconds_ago("ws", TICKET_MAX_AGE_SECONDS, seconds_ago=61)
    assert decode_ticket_token(_SECRET, ticket, expected_purpose="ws") is None


def test_chug_upload_ticket_survives_a_slow_real_upload():
    """The real bug, found live in production logs: a real chug upload
    401'd with "Not signed in" 61 seconds after minting its ticket —
    FastAPI/Starlette fully receives an UploadFile parameter's request
    body BEFORE upload_chug's own handler (and its ticket check) ever
    runs, so a ticket good for only TICKET_MAX_AGE_SECONDS (60s, meant
    for a quick WS handshake) was being judged against how long the
    WHOLE video transfer took, not how long it took to start. A ticket
    minted for the chug_upload purpose specifically must survive well
    past that same 61-second mark."""
    ticket = _ticket_minted_seconds_ago("chug_upload", CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS, seconds_ago=61)
    payload = decode_ticket_token(_SECRET, ticket, expected_purpose="chug_upload")
    assert payload is not None
    assert payload["user_id"] == 1


def test_chug_upload_ticket_eventually_still_expires():
    """Not infinite — still bounded, same as every other ticket."""
    ticket = _ticket_minted_seconds_ago(
        "chug_upload", CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS, seconds_ago=CHUG_UPLOAD_TICKET_MAX_AGE_SECONDS + 5
    )
    assert decode_ticket_token(_SECRET, ticket, expected_purpose="chug_upload") is None
