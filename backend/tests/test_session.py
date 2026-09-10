from app.auth.session import create_session_token, decode_session_token, get_session_token


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
