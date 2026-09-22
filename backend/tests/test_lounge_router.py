"""Lounge — standalone password-protected video rooms. See
app/routers/lounge.py's own docstring for why this is deliberately not
an extension of Watch Party. Session cookies here are minted against a
plain make_safe_session_user_id() row (no owner, no league) precisely
because that's the whole point of the feature: creating a room must
work for an account that has never joined a league."""
from httpx import ASGITransport, AsyncClient

from app import config
from app.auth.session import create_session_token
from app.main import app
from tests.conftest import make_safe_session_user_id

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool):
    user_id = await make_safe_session_user_id(pool)
    token = create_session_token(_SESSION_SECRET, user_id=user_id)
    return user_id, {"session": token}


def _configure_livekit(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    # app/config.py reads LIVEKIT_* into module-level globals once at
    # import time (same optional-at-import pattern as RESEND_*), so a
    # plain monkeypatch.setenv here — after app.config has already been
    # imported by app.main — would never be seen by
    # require_livekit_configured(). Patching the globals directly is
    # the one way to make that function see test values.
    monkeypatch.setattr(config, "LIVEKIT_API_KEY", "test-key")
    monkeypatch.setattr(config, "LIVEKIT_API_SECRET", "test-secret-livekit")
    monkeypatch.setattr(config, "LIVEKIT_URL", "wss://test.livekit.cloud")


async def _create_room(client, name="Sunday Watch", password="hunter22"):
    resp = await client.post("/lounge/rooms", json={"name": name, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---- create ---------------------------------------------------------------


async def test_create_requires_session():
    async with _client() as client:
        resp = await client.post("/lounge/rooms", json={"name": "x", "password": "hunter22"})
    assert resp.status_code == 401


async def test_create_succeeds_with_no_league_membership(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client)

    assert room["name"] == "Sunday Watch"
    assert isinstance(room["slug"], str) and len(room["slug"]) > 10


# ---- metadata ---------------------------------------------------------------


async def test_metadata_is_public_and_minimal(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client)

    async with _client() as anon_client:
        resp = await anon_client.get(f"/lounge/rooms/{room['slug']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"name": "Sunday Watch", "closed": False}


async def test_metadata_404s_for_unknown_slug():
    async with _client() as client:
        resp = await client.get("/lounge/rooms/does-not-exist")
    assert resp.status_code == 404


# ---- join -------------------------------------------------------------------


async def test_guest_can_join_with_correct_password_and_no_account(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

    async with _client() as guest_client:
        resp = await guest_client.post(
            f"/lounge/rooms/{room['slug']}/join",
            json={"password": "hunter22", "display_name": "A Friend"},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_name"] == "A Friend"
    assert body["room_name"] == f"lounge-{room['id']}"
    assert body["token"]


async def test_logged_in_joiner_uses_their_own_identity(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

    async with _client() as joiner_client:
        _, joiner_cookie = await _session_cookie(pool)
        joiner_client.cookies.update(joiner_cookie)
        resp = await joiner_client.post(
            f"/lounge/rooms/{room['slug']}/join", json={"password": "hunter22"}
        )
    assert resp.status_code == 200, resp.text


async def test_creator_can_rejoin_without_the_password(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

        resp = await client.post(f"/lounge/rooms/{room['slug']}/join", json={})
    assert resp.status_code == 200, resp.text


async def test_creator_rejoin_ignores_a_wrong_password(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

        resp = await client.post(f"/lounge/rooms/{room['slug']}/join", json={"password": "totally-wrong"})
    assert resp.status_code == 200, resp.text


async def test_signed_in_joiner_can_override_their_display_name(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

    async with _client() as joiner_client:
        _, joiner_cookie = await _session_cookie(pool)
        joiner_client.cookies.update(joiner_cookie)
        resp = await joiner_client.post(
            f"/lounge/rooms/{room['slug']}/join",
            json={"password": "hunter22", "display_name": "Game Night Sam"},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["display_name"] == "Game Night Sam"


async def test_guest_join_requires_display_name(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

    async with _client() as guest_client:
        resp = await guest_client.post(
            f"/lounge/rooms/{room['slug']}/join", json={"password": "hunter22"}
        )
    assert resp.status_code == 400


async def test_wrong_password_is_rejected_and_locks_out_after_max_attempts(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

    async with _client() as guest_client:
        for _ in range(8):
            resp = await guest_client.post(
                f"/lounge/rooms/{room['slug']}/join",
                json={"password": "wrong", "display_name": "Guessy"},
            )
            assert resp.status_code == 401

        locked_resp = await guest_client.post(
            f"/lounge/rooms/{room['slug']}/join",
            json={"password": "hunter22", "display_name": "Guessy"},
        )
    assert locked_resp.status_code == 429


async def test_join_on_closed_room_404s(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client, password="hunter22")

        close_resp = await client.delete(f"/lounge/rooms/{room['id']}")
        assert close_resp.status_code == 200

    async with _client() as guest_client:
        resp = await guest_client.post(
            f"/lounge/rooms/{room['slug']}/join",
            json={"password": "hunter22", "display_name": "Late"},
        )
    assert resp.status_code == 404


# ---- close ------------------------------------------------------------------


async def test_close_is_creator_only(pool, monkeypatch):
    _configure_livekit(monkeypatch)
    async with _client() as client:
        _, cookie = await _session_cookie(pool)
        client.cookies.update(cookie)
        room = await _create_room(client)

    async with _client() as other_client:
        _, other_cookie = await _session_cookie(pool)
        other_client.cookies.update(other_cookie)
        resp = await other_client.delete(f"/lounge/rooms/{room['id']}")
    assert resp.status_code == 404
