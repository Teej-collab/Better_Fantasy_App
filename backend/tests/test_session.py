from app.auth.session import create_session_token, decode_session_token


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
