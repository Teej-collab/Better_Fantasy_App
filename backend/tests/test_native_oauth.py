"""Native OAuth deep-link completion — the client=native branch added to
app/routers/auth.py's Discord/Google login/callback routes, plus the
new POST /auth/native/redeem single-use ticket exchange. See
docs/NATIVE_PHASE_1_API.md for the full design.

Every test here that omits `client` (or passes client=web) exercising
the EXISTING web flow lives in test_auth.py, not here — this file is
scoped to the new native-only behavior."""
import uuid
from urllib.parse import parse_qs, urlparse

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_ticket_token, decode_session_token
from app.main import app
from tests.conftest import make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


def _set_discord_env(monkeypatch):
    monkeypatch.setenv("DISCORD_CLIENT_ID", "fake-client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/discord/callback")
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    monkeypatch.delenv("COMMISSIONER_DISCORD_ID", raising=False)
    monkeypatch.delenv("NATIVE_APP_UNIVERSAL_LINK_BASE", raising=False)


async def _seed_owner_with_discord_id(pool, discord_user_id, display_name):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, discord_user_id, display_name) "
            "VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-native-oauth-member-{discord_user_id}", discord_user_id, display_name,
        )


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-native-oauth-owner-{suffix}", f"Owner {suffix}",
        )


def _query_param(location: str, name: str) -> str:
    return parse_qs(urlparse(location).query)[name][0]


# ---- kickoff -----------------------------------------------------------


async def test_native_discord_login_prefixes_state_with_client_type(monkeypatch):
    _set_discord_env(monkeypatch)
    async with _client() as client:
        resp = await client.get("/auth/discord/login", params={"client": "native"}, follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert resp.cookies["oauth_state"].startswith("native:")


async def test_web_discord_login_still_defaults_to_a_plain_web_state(monkeypatch):
    """Regression guard, not just a happy-path check — every existing
    caller omits `client` entirely, so the default must keep producing
    a state this same test file's own assumptions (and test_auth.py's
    existing assertions) already depend on."""
    _set_discord_env(monkeypatch)
    async with _client() as client:
        resp = await client.get("/auth/discord/login", follow_redirects=False)
    assert resp.cookies["oauth_state"].startswith("web:")


async def test_native_discord_login_rejects_an_unknown_client_value(monkeypatch):
    _set_discord_env(monkeypatch)
    async with _client() as client:
        resp = await client.get("/auth/discord/login", params={"client": "desktop"}, follow_redirects=False)
    assert resp.status_code == 400


# ---- callback: deep link, not a token fragment --------------------------


async def test_native_discord_callback_redirects_to_a_deep_link_with_a_ticket(pool, monkeypatch):
    _set_discord_env(monkeypatch)
    discord_id = 910000001
    await _seed_owner_with_discord_id(pool, discord_id, "Native Alice")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "nativealice"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", params={"client": "native"}, follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        callback_resp = await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False,
        )

    assert callback_resp.status_code in (302, 307)
    location = callback_resp.headers["location"]
    assert location.startswith("http://localhost:3000/auth/native-complete?ticket=")
    # No same-domain cookie for a native completion — the whole point
    # is a native client has no browser cookie jar to use.
    assert "session" not in callback_resp.cookies
    assert _query_param(location, "ticket")


async def test_native_discord_callback_not_a_league_member_redirects_to_a_native_error(monkeypatch):
    _set_discord_env(monkeypatch)
    discord_id = 910000002  # never seeded as an owner

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "nobody"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", params={"client": "native"}, follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        callback_resp = await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False,
        )

    location = callback_resp.headers["location"]
    assert location.startswith("http://localhost:3000/auth/native-complete?error=")
    assert _query_param(location, "error") == "not_a_league_member"


# ---- ticket redemption: single-use, expiry, malformed input -------------


async def _mint_ticket(pool, owner_id, *, jti=None, max_age_seconds=60, discord_user_id=None, is_commissioner=False):
    # A fresh, "test-"-prefixed jti per call by default (never a fixed
    # literal) — used_oauth_tickets records every redemption permanently
    # (see migration 4b0f790da9c8's own docstring on why it tracks
    # redeemed, not issued, tickets) and cleanup_test_season sweeps rows
    # by this same "test-" prefix; a hardcoded jti would collide with
    # its own prior test run's already-redeemed row and get rejected as
    # a false replay, unrelated to whatever this test actually means to
    # exercise. Callers that need a specific reused jti (e.g. redeeming
    # the SAME ticket twice on purpose) still get one, just not a
    # cross-run-colliding literal.
    jti = jti or f"test-jti-{uuid.uuid4().hex}"
    user_id = await make_safe_session_user_id_for_owner(pool, owner_id)
    ticket = create_ticket_token(
        _SESSION_SECRET, purpose="native_oauth", user_id=user_id, owner_id=owner_id,
        discord_user_id=discord_user_id, is_commissioner=is_commissioner,
        max_age_seconds=max_age_seconds, jti=jti,
    )
    return ticket, user_id


async def test_redeem_a_valid_ticket_succeeds(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "redeem-1")
    ticket, user_id = await _mint_ticket(pool, owner_id)

    async with _client() as client:
        resp = await client.post("/auth/native/redeem", json={"ticket": ticket})

    assert resp.status_code == 200
    payload = decode_session_token(_SESSION_SECRET, resp.json()["token"])
    assert payload["user_id"] == user_id
    assert payload["owner_id"] == owner_id


async def test_redeem_the_same_ticket_twice_fails_the_second_time(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "redeem-2")
    ticket, _ = await _mint_ticket(pool, owner_id)

    async with _client() as client:
        first = await client.post("/auth/native/redeem", json={"ticket": ticket})
        second = await client.post("/auth/native/redeem", json={"ticket": ticket})

    assert first.status_code == 200
    assert second.status_code == 401


async def test_redeem_an_expired_ticket_is_rejected(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "redeem-3")
    ticket, _ = await _mint_ticket(pool, owner_id, max_age_seconds=-1)

    async with _client() as client:
        resp = await client.post("/auth/native/redeem", json={"ticket": ticket})

    assert resp.status_code == 401


async def test_redeem_a_malformed_ticket_is_rejected():
    async with _client() as client:
        resp = await client.post("/auth/native/redeem", json={"ticket": "not-a-real-jwt"})
    assert resp.status_code == 401


async def test_redeem_rejects_a_ticket_minted_for_a_different_purpose(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "redeem-4")
    user_id = await make_safe_session_user_id_for_owner(pool, owner_id)
    ws_ticket = create_ticket_token(
        _SESSION_SECRET, purpose="ws", user_id=user_id, owner_id=owner_id,
        discord_user_id=None, is_commissioner=False,
    )

    async with _client() as client:
        resp = await client.post("/auth/native/redeem", json={"ticket": ws_ticket})

    assert resp.status_code == 401


async def test_redeem_produces_a_session_only_for_the_ticket_own_account(pool, monkeypatch):
    """A ticket cannot be used to obtain an unrelated account's session
    — the redeemed session always matches exactly the (user_id,
    owner_id) embedded in the ticket at mint time. There is no other
    input on the redeem request (just the ticket) that could steer it
    toward a different account."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a = await _seed_owner(pool, "redeem-5a")
    owner_b = await _seed_owner(pool, "redeem-5b")
    ticket, user_id_a = await _mint_ticket(pool, owner_a)
    await make_safe_session_user_id_for_owner(pool, owner_b)  # a real, unrelated account

    async with _client() as client:
        resp = await client.post("/auth/native/redeem", json={"ticket": ticket})

    assert resp.status_code == 200
    payload = decode_session_token(_SESSION_SECRET, resp.json()["token"])
    assert payload["owner_id"] == owner_a
    assert payload["user_id"] == user_id_a


async def test_failed_redemption_never_creates_an_authenticated_session(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "redeem-6")
    ticket, _ = await _mint_ticket(pool, owner_id)

    async with _client() as client:
        first_resp = await client.post("/auth/native/redeem", json={"ticket": ticket})
        assert first_resp.status_code == 200  # the one real, successful use
        replay_resp = await client.post("/auth/native/redeem", json={"ticket": ticket})
        assert replay_resp.status_code == 401
        assert "session" not in replay_resp.cookies

        # Neither the successful nor the failed call ever sets a
        # cookie (the token is only ever returned in a response body,
        # by design — see redeem_native_oauth_ticket's own docstring),
        # so this client has no cookie-based session at all.
        me_resp = await client.get("/auth/me")
    assert me_resp.status_code == 401
