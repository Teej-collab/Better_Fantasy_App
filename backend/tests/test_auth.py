import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.session import decode_ticket_token
from app.main import app


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


def _set_discord_env(monkeypatch):
    monkeypatch.setenv("DISCORD_CLIENT_ID", "fake-client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/discord/callback")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    monkeypatch.delenv("COMMISSIONER_DISCORD_ID", raising=False)


async def _seed_owner_with_discord_id(pool, discord_user_id, display_name):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, discord_user_id, display_name) "
            "VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-auth-member-{discord_user_id}", discord_user_id, display_name,
        )


async def test_login_redirects_to_discord_and_sets_state_cookie(monkeypatch):
    _set_discord_env(monkeypatch)
    async with _client() as client:
        resp = await client.get("/auth/discord/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "discord.com/api/oauth2/authorize" in resp.headers["location"]
    assert "fake-client-id" in resp.headers["location"]
    assert "oauth_state" in resp.cookies


async def test_callback_creates_session_for_known_league_member(pool, monkeypatch):
    _set_discord_env(monkeypatch)
    discord_id = 900000001
    await _seed_owner_with_discord_id(pool, discord_id, "Alice Smith")

    async def fake_exchange(config, code):
        assert code == "fake-code"
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        assert access_token == "fake-access-token"
        return {"id": str(discord_id), "username": "alice"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]

        callback_resp = await client.get(
            "/auth/discord/callback",
            params={"code": "fake-code", "state": state},
            follow_redirects=False,
        )
        assert callback_resp.status_code in (302, 307)
        # /auth/complete#token=... handoff — see auth.py's module comment
        # on why the frontend needs its own first-party copy of the
        # token (this cookie, on the backend's own domain, is real and
        # still needed for direct browser->backend calls, but a
        # different domain than the frontend can never see it).
        location = callback_resp.headers["location"]
        assert location.startswith("http://localhost:3000/auth/complete#token=")
        token_from_redirect = location.split("#token=", 1)[1]
        assert "session" in callback_resp.cookies
        assert callback_resp.cookies["session"] == token_from_redirect

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 200
        body = me_resp.json()
        assert body["display_name"] == "Alice Smith"
        assert body["is_commissioner"] is False


async def test_login_auto_enrolls_into_the_default_league_if_one_exists(pool, monkeypatch):
    """Phase 2 of the multi-league migration (see TODO.md's PHASE 9
    entry) — most existing league members have never actually logged
    into the web app before, so a first-time login should also create
    a league_members row for the one real league, rather than relying
    on a one-off script to be re-run for each of them later."""
    _set_discord_env(monkeypatch)
    discord_id = 900000006
    await _seed_owner_with_discord_id(pool, discord_id, "Auto Enroll User")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "autoenroll"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with pool.acquire() as conn:
        league_id = await conn.fetchval("SELECT id FROM leagues ORDER BY id LIMIT 1")
    if league_id is None:
        pytest.skip("no league backfilled yet in this environment")

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )

    async with pool.acquire() as conn:
        user_id = await conn.fetchval("SELECT user_id FROM owners WHERE discord_user_id = $1", discord_id)
        role = await conn.fetchval(
            "SELECT role FROM league_members WHERE league_id = $1 AND user_id = $2", league_id, user_id
        )
    assert role == "member"


async def test_callback_denies_discord_user_not_in_league(pool, monkeypatch):
    _set_discord_env(monkeypatch)

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": "123456999", "username": "stranger"}  # not seeded as any owner

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]

        callback_resp = await client.get(
            "/auth/discord/callback",
            params={"code": "fake-code", "state": state},
            follow_redirects=False,
        )
        assert callback_resp.status_code in (302, 307)
        assert callback_resp.headers["location"] == "http://localhost:3000/login?error=not_a_league_member"
        assert "session" not in callback_resp.cookies

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 401


async def test_callback_rejects_state_mismatch(monkeypatch):
    _set_discord_env(monkeypatch)
    async with _client() as client:
        await client.get("/auth/discord/login", follow_redirects=False)
        resp = await client.get(
            "/auth/discord/callback",
            params={"code": "fake-code", "state": "wrong-state"},
        )
    assert resp.status_code == 400


async def test_me_requires_session():
    async with _client() as client:
        resp = await client.get("/auth/me")
    assert resp.status_code == 401


async def test_logout_clears_session_cookie(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        resp = await client.post("/auth/logout")
    assert resp.status_code == 204
    assert resp.cookies.get("session") is None


async def test_ticket_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        resp = await client.post("/auth/ticket", params={"purpose": "ws"})
    assert resp.status_code == 401


async def test_ticket_rejects_unknown_purpose(pool, monkeypatch):
    _set_discord_env(monkeypatch)
    discord_id = 900000004
    await _seed_owner_with_discord_id(pool, discord_id, "Ticket User")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "ticketuser"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )
        resp = await client.post("/auth/ticket", params={"purpose": "not_a_real_purpose"})
    assert resp.status_code == 400


async def test_ticket_mints_a_purpose_scoped_short_lived_token(pool, monkeypatch):
    """The real point of a ticket: usable for exactly the purpose it was
    minted for, and nothing else — a ws ticket can't be replayed as a
    chug_upload ticket even though both are signed with the same secret."""
    _set_discord_env(monkeypatch)
    discord_id = 900000005
    await _seed_owner_with_discord_id(pool, discord_id, "Ticket User Two")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "ticketusertwo"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )
        resp = await client.post("/auth/ticket", params={"purpose": "ws"})

    assert resp.status_code == 200
    ticket = resp.json()["ticket"]

    secret = "test-secret-thats-at-least-32-bytes-long"
    payload = decode_ticket_token(secret, ticket, expected_purpose="ws")
    assert payload is not None
    assert payload["discord_user_id"] == discord_id

    assert decode_ticket_token(secret, ticket, expected_purpose="chug_upload") is None


def _set_cookie_header(resp, cookie_name: str) -> str:
    for raw in resp.headers.get_list("set-cookie"):
        if raw.startswith(f"{cookie_name}="):
            return raw
    raise AssertionError(f"no Set-Cookie for {cookie_name!r} in {resp.headers.get_list('set-cookie')}")


async def test_session_cookie_is_lax_not_secure_when_cookie_secure_unset(pool, monkeypatch):
    """Local dev: frontend and backend share a site (same host, different
    ports) — SameSite=Lax already lets fetch(credentials:"include") work,
    and plain HTTP (e.g. a phone on the LAN) can't set a Secure cookie at
    all, so it must stay off."""
    _set_discord_env(monkeypatch)
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
    discord_id = 900000002
    await _seed_owner_with_discord_id(pool, discord_id, "Local Dev User")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "localdev"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        callback_resp = await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )

    raw = _set_cookie_header(callback_resp, "session")
    assert "samesite=lax" in raw.lower()
    assert "secure" not in raw.lower()


async def test_session_cookie_is_none_and_secure_in_production(pool, monkeypatch):
    """Real production: frontend (vercel.app) and backend (railway.app)
    are genuinely different sites — SameSite=Lax would silently never
    attach the cookie to the frontend's cross-site fetch(credentials:
    "include") calls (Lax only allows top-level navigations), so a
    signed-in user would immediately look signed-out again. SameSite=None
    requires Secure, which real HTTPS provides."""
    _set_discord_env(monkeypatch)
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    discord_id = 900000003
    await _seed_owner_with_discord_id(pool, discord_id, "Prod User")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "produser"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    # Secure cookies only round-trip through httpx's cookie jar (like a
    # real browser) over an actual https:// connection — matches real
    # production, unlike the plain-http default the other tests use.
    async with _client(base_url="https://test") as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        callback_resp = await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )

    raw = _set_cookie_header(callback_resp, "session")
    assert "samesite=none" in raw.lower()
    assert "secure" in raw.lower()


async def test_logout_clears_cookie_with_matching_attributes_in_production(monkeypatch):
    """A delete_cookie call that doesn't also mark Secure/SameSite=None
    won't reliably clear a cookie that was set with those attributes —
    browsers won't let a "weaker" Set-Cookie silently override a Secure
    one."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    async with _client() as client:
        resp = await client.post("/auth/logout")

    raw = _set_cookie_header(resp, "session")
    assert "samesite=none" in raw.lower()
    assert "secure" in raw.lower()
