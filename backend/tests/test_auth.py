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


def _set_google_env(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "fake-google-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "fake-google-client-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")


async def test_google_login_redirects_to_google_and_sets_state_cookie(monkeypatch):
    _set_google_env(monkeypatch)
    async with _client() as client:
        resp = await client.get("/auth/google/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "accounts.google.com/o/oauth2/v2/auth" in resp.headers["location"]
    assert "fake-google-client-id" in resp.headers["location"]
    assert "oauth_state" in resp.cookies


async def test_google_callback_creates_a_new_self_serve_account(pool, monkeypatch):
    """Unlike Discord, Google has no pre-existing membership to verify
    against — a first-time Google sign-in should succeed and create a
    real account with no owner/league yet, same shape as /auth/signup."""
    _set_google_env(monkeypatch)

    async def fake_exchange(config, code):
        assert code == "fake-code"
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        assert access_token == "fake-access-token"
        return {"sub": "goog-900000002", "email": "test-google-new@example.com", "name": "Gina Google"}

    monkeypatch.setattr("app.routers.auth.google_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.google_oauth.fetch_google_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/google/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]

        callback_resp = await client.get(
            "/auth/google/callback",
            params={"code": "fake-code", "state": state},
            follow_redirects=False,
        )
        assert callback_resp.status_code in (302, 307)
        location = callback_resp.headers["location"]
        assert location.startswith("http://localhost:3000/auth/complete#token=")
        assert "session" in callback_resp.cookies

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 200
        body = me_resp.json()
        assert body["display_name"] == "Gina Google"
        # No owner yet — this is a fresh self-serve account, not a
        # verified league member the way Discord sign-in already is.
        assert body["owner_id"] is None
        assert body["is_commissioner"] is False


async def test_google_callback_links_to_an_existing_account_with_the_same_email(pool, monkeypatch):
    """A real, deliberate difference from Discord's no-linking
    precedent (see get_or_create_user_for_google's own docstring):
    Google always returns a verified email, so signing in with Google
    using the same email as an existing password account links onto
    that account instead of silently creating a confusing duplicate."""
    _set_google_env(monkeypatch)
    email = "test-google-linked@example.com"

    async with pool.acquire() as conn:
        existing_user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'irrelevant-hash', 'Original Name') "
            "RETURNING id",
            email,
        )

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"sub": "goog-900000003", "email": email, "name": "Google Display Name"}

    monkeypatch.setattr("app.routers.auth.google_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.google_oauth.fetch_google_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/google/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/google/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id, google_user_id FROM users WHERE email = $1", email)
    assert row["id"] == existing_user_id  # same account, not a new one
    assert row["google_user_id"] == "goog-900000003"


async def test_google_callback_rejects_state_mismatch(monkeypatch):
    _set_google_env(monkeypatch)
    async with _client() as client:
        await client.get("/auth/google/login", follow_redirects=False)
        resp = await client.get(
            "/auth/google/callback",
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


async def test_signup_creates_account_and_session(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        resp = await client.post(
            "/auth/signup",
            json={"email": "test-signup-1@example.com", "password": "correct-horse", "display_name": "New Person"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "token" in body
        assert "session" in resp.cookies

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 200
        me_body = me_resp.json()
        assert me_body["display_name"] == "New Person"
        assert me_body["owner_id"] is None
        assert me_body["is_commissioner"] is False


async def test_signup_rejects_duplicate_email(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        first = await client.post(
            "/auth/signup",
            json={"email": "test-signup-dup@example.com", "password": "correct-horse", "display_name": "First"},
        )
        assert first.status_code == 200
        second = await client.post(
            "/auth/signup",
            json={"email": "test-signup-dup@example.com", "password": "another-password", "display_name": "Second"},
        )
        assert second.status_code == 409


async def test_signup_rejects_short_password(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        resp = await client.post(
            "/auth/signup",
            json={"email": "test-signup-short@example.com", "password": "short", "display_name": "Someone"},
        )
    assert resp.status_code == 400


async def test_login_succeeds_with_correct_password(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": "test-login-ok@example.com", "password": "correct-horse", "display_name": "Login Test"},
        )
        # Fresh client, no cookie carried over — a real second visit.
        async with _client() as fresh_client:
            resp = await fresh_client.post(
                "/auth/login", json={"email": "test-login-ok@example.com", "password": "correct-horse"}
            )
            assert resp.status_code == 200
            assert "token" in resp.json()

            me_resp = await fresh_client.get("/auth/me")
            assert me_resp.status_code == 200
            assert me_resp.json()["display_name"] == "Login Test"


async def test_login_rejects_wrong_password(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": "test-login-wrong@example.com", "password": "correct-horse", "display_name": "Someone"},
        )
        resp = await client.post("/auth/login", json={"email": "test-login-wrong@example.com", "password": "nope"})
    assert resp.status_code == 401


async def test_login_rejects_unknown_email(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        resp = await client.post(
            "/auth/login", json={"email": "test-login-nobody@example.com", "password": "whatever1"}
        )
    assert resp.status_code == 401


async def test_login_rejects_discord_only_account_with_no_password(pool, monkeypatch):
    """A Discord-linked user has no password_hash at all — a login
    attempt with their (nonexistent) email/password should read as the
    same generic denial as any other wrong credential, not a crash or a
    different error that would reveal the account exists but has no
    password."""
    _set_discord_env(monkeypatch)
    discord_id = 900000007
    await _seed_owner_with_discord_id(pool, discord_id, "Discord Only User")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "discordonly"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )

    async with pool.acquire() as conn:
        user_id = await conn.fetchval("SELECT user_id FROM owners WHERE discord_user_id = $1", discord_id)
        await conn.execute("UPDATE users SET email = $1 WHERE id = $2", "test-discord-only@example.com", user_id)

    async with _client() as fresh_client:
        resp = await fresh_client.post(
            "/auth/login", json={"email": "test-discord-only@example.com", "password": "whatever1"}
        )
    assert resp.status_code == 401


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
