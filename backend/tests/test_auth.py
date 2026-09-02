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


async def test_google_callback_links_to_an_existing_passwordless_account_with_the_same_email(pool, monkeypatch):
    """A real, deliberate difference from Discord's no-linking
    precedent (see get_or_create_user_for_google's own docstring):
    Google always returns a verified email, so signing in with Google
    using the same email as an existing PASSWORDLESS account links onto
    that account instead of silently creating a confusing duplicate."""
    _set_google_env(monkeypatch)
    email = "test-google-linked@example.com"

    async with pool.acquire() as conn:
        existing_user_id = await conn.fetchval(
            "INSERT INTO users (email, display_name) VALUES ($1, 'Original Name') RETURNING id",
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


async def test_google_callback_does_not_hijack_an_existing_password_account_with_the_same_email(pool, monkeypatch):
    """Security regression test (fixed 2026-09) — /auth/signup has no
    email verification, so before this fix, anyone could pre-register a
    victim's email with a password of their own choosing and silently
    inherit the victim's account the moment the victim later signed in
    with Google using that same email (see get_or_create_user_for_google's
    own docstring for the full exploit chain). A Google callback must
    NEVER link onto a row that already has a password — it should create
    a genuinely separate account instead, leaving the original
    password-protected account (and whoever's password is on it)
    completely untouched."""
    _set_google_env(monkeypatch)
    email = "test-google-attacker-preregistered@example.com"

    async with pool.acquire() as conn:
        attacker_user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'attacker-set-hash', 'Attacker') "
            "RETURNING id",
            email,
        )

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"sub": "goog-900000004", "email": email, "name": "Real Victim"}

    monkeypatch.setattr("app.routers.auth.google_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.google_oauth.fetch_google_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/google/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/google/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )

    async with pool.acquire() as conn:
        attacker_row = await conn.fetchrow("SELECT google_user_id FROM users WHERE id = $1", attacker_user_id)
        victim_row = await conn.fetchrow("SELECT id, email FROM users WHERE google_user_id = $1", "goog-900000004")

    # The attacker's password-protected row was never touched.
    assert attacker_row["google_user_id"] is None
    # The Google sign-in got its own new account instead of the attacker's.
    assert victim_row is not None
    assert victim_row["id"] != attacker_user_id
    # email is left unset on the new row — it's already (uniquely) claimed
    # by the attacker's row, per users_email_key.
    assert victim_row["email"] is None


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


async def test_logout_revokes_the_session_token_immediately(pool, monkeypatch):
    """Security regression test (2026-09 audit fix) — logout used to
    only ever clear the cookie client-side; a copied/leaked token
    stayed fully valid regardless of logout, for its whole 30-day life.
    Now logout bumps users.token_version, so ANY copy of that same
    token — not just the one cookie this response happens to clear —
    is rejected by app/main.py's session_revocation middleware from
    that moment on."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    email = "test-revoke-logout@example.com"

    async with _client() as signup_client:
        signup_resp = await signup_client.post(
            "/auth/signup",
            json={"email": email, "password": "correct-horse", "display_name": "Revoke Test"},
        )
        token = signup_resp.json()["token"]

    # A second, independent client carrying a COPY of the same raw
    # token — simulating it having leaked/been captured separately from
    # whatever cookie the real account holder's own browser still has.
    async with _client() as copy_client:
        copy_client.cookies.update({"session": token})
        me_resp = await copy_client.get("/auth/me")
        assert me_resp.status_code == 200

        async with _client() as real_client:
            real_client.cookies.update({"session": token})
            logout_resp = await real_client.post("/auth/logout")
            assert logout_resp.status_code == 204

        # The copy's own cookie never changed, but the token itself is
        # now dead everywhere.
        me_resp_after = await copy_client.get("/auth/me")
        assert me_resp_after.status_code == 401


async def test_a_fresh_login_after_logout_still_works(pool, monkeypatch):
    """The other half of the same fix — logout bumping token_version
    must not lock the real account holder out of their OWN next login;
    a freshly-issued token has to carry the NEW token_version, not
    whatever value create_session_token defaults to."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    email = "test-revoke-relogin@example.com"

    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": email, "password": "correct-horse", "display_name": "Relogin Test"},
        )
        await client.post("/auth/logout")

        login_resp = await client.post("/auth/login", json={"email": email, "password": "correct-horse"})
        assert login_resp.status_code == 200

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 200


async def test_deleted_account_token_is_rejected(pool, monkeypatch):
    """DELETE /auth/me removes the users row entirely — the same
    session_revocation middleware that enforces logout also has to
    treat "no such user anymore" as revoked, not let a stale token for
    a deleted account keep passing signature/expiry checks forever."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    email = "test-revoke-delete@example.com"

    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": email, "password": "correct-horse", "display_name": "Delete Test"},
        )
        me_before = await client.get("/auth/me")
        assert me_before.status_code == 200

        delete_resp = await client.delete("/auth/me")
        assert delete_resp.status_code == 204

        me_after = await client.get("/auth/me")
        assert me_after.status_code == 401


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
        assert me_body["active_league_id"] is None


async def test_auth_me_reports_live_commissioner_status_for_active_league(pool, monkeypatch):
    """is_commissioner is a live per-active-league DB check now, not the
    JWT's own stale claim (set once at login from the global
    COMMISSIONER_DISCORD_ID env var) — see TODO.md's PHASE 9 entry.
    Creating a league makes you its commissioner and auto-activates it,
    so /auth/me should reflect both immediately with no extra action."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": "test-me-commish@example.com", "password": "correct-horse", "display_name": "Commish"},
        )
        created = await client.post("/leagues", json={"name": "Test League Me Commish"})
        league_id = created.json()["id"]

        me_resp = await client.get("/auth/me")
        me_body = me_resp.json()
        assert me_body["active_league_id"] == league_id
        assert me_body["is_commissioner"] is True


async def test_auth_me_reports_false_commissioner_for_a_regular_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as creator:
        await creator.post(
            "/auth/signup",
            json={"email": "test-me-member-creator@example.com", "password": "correct-horse", "display_name": "Creator"},
        )
        created = await creator.post("/leagues", json={"name": "Test League Me Member"})
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await member.post(
            "/auth/signup",
            json={"email": "test-me-member@example.com", "password": "correct-horse", "display_name": "Member"},
        )
        await member.post("/leagues/join", json={"invite_code": invite_code})

        me_resp = await member.get("/auth/me")
        me_body = me_resp.json()
        assert me_body["active_league_id"] == created.json()["id"]
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


async def test_signup_rate_limited_after_repeated_attempts(monkeypatch):
    """Security regression test (2026-09 audit fix) — POST /auth/signup
    had no rate limiting at all, letting an attacker spam signup
    attempts for the same email with no limit. Now capped at 5 attempts
    per 15-minute window per targeted email (app/auth/rate_limit.py);
    the 6th attempt in that window gets a 429 regardless of what else
    is wrong with the request."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    email = "test-ratelimit-signup@example.com"
    async with _client() as client:
        for _ in range(5):
            resp = await client.post(
                "/auth/signup", json={"email": email, "password": "short", "display_name": "X"}
            )
            assert resp.status_code == 400  # short password — still counts as a rate-limited attempt
        resp = await client.post(
            "/auth/signup", json={"email": email, "password": "short", "display_name": "X"}
        )
    assert resp.status_code == 429


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


async def test_login_rate_limited_after_repeated_attempts(monkeypatch):
    """Security regression test (2026-09 audit fix) — POST /auth/login
    had no rate limiting at all, letting an attacker brute-force a
    password with unlimited attempts. Now capped at 5 attempts per
    15-minute window per targeted email; the 6th attempt in that window
    gets a 429 regardless of whether any individual password was
    right or wrong."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    email = "test-ratelimit-login@example.com"
    async with _client() as client:
        for _ in range(5):
            resp = await client.post("/auth/login", json={"email": email, "password": "whatever-wrong"})
            assert resp.status_code == 401
        resp = await client.post("/auth/login", json={"email": email, "password": "whatever-wrong"})
    assert resp.status_code == 429


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


async def test_delete_account_requires_session():
    async with _client() as client:
        resp = await client.delete("/auth/me")
    assert resp.status_code == 401


async def test_delete_account_removes_a_bare_signup(pool, monkeypatch):
    """The common case this feature exists for: a self-serve email/
    Google signup that never joined or created a league — no owner to
    unlink, no league to leave, just delete the login outright."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        signup = await client.post(
            "/auth/signup",
            json={"email": "test-delete-bare@example.com", "password": "correct-horse", "display_name": "Bare"},
        )
        user_id = (await client.get("/auth/me")).json()["user_id"]

        resp = await client.delete("/auth/me")
        assert resp.status_code == 204
        assert resp.cookies.get("session") is None

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 401

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
    assert row is None
    assert signup.status_code == 200


async def test_delete_account_unlinks_a_claimed_owner_without_deleting_league_history(pool, monkeypatch):
    """A claimed owner identity (owners.user_id) must survive account
    deletion — that owner's teams, chat messages, and history are
    shared with the rest of the league, not this login's to erase."""
    _set_discord_env(monkeypatch)
    discord_id = 900000101
    owner_id = await _seed_owner_with_discord_id(pool, discord_id, "Deletable Discord User")

    async def fake_exchange(config, code):
        return "fake-access-token"

    async def fake_fetch_user(access_token):
        return {"id": str(discord_id), "username": "deletable"}

    monkeypatch.setattr("app.routers.auth.discord_oauth.exchange_code_for_token", fake_exchange)
    monkeypatch.setattr("app.routers.auth.discord_oauth.fetch_discord_user", fake_fetch_user)

    async with _client() as client:
        login_resp = await client.get("/auth/discord/login", follow_redirects=False)
        state = login_resp.cookies["oauth_state"]
        await client.get(
            "/auth/discord/callback", params={"code": "fake-code", "state": state}, follow_redirects=False
        )
        user_id = (await client.get("/auth/me")).json()["user_id"]

        resp = await client.delete("/auth/me")
        assert resp.status_code == 204

    async with pool.acquire() as conn:
        user_row = await conn.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
        owner_row = await conn.fetchrow("SELECT owner_id, user_id, display_name FROM owners WHERE owner_id = $1", owner_id)
    assert user_row is None
    assert owner_row is not None
    assert owner_row["user_id"] is None
    assert owner_row["display_name"] == "Deletable Discord User"


async def test_delete_account_blocked_for_league_creator(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": "test-delete-creator@example.com", "password": "correct-horse", "display_name": "Creator"},
        )
        created = await client.post("/leagues", json={"name": "Test League Unkillable"})
        assert created.status_code == 200

        resp = await client.delete("/auth/me")
        assert resp.status_code == 409
        assert "Test League Unkillable" in resp.json()["detail"]

        # Nothing was actually touched.
        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 200


async def test_delete_account_blocked_for_sole_commissioner_with_other_members(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as creator:
        await creator.post(
            "/auth/signup",
            json={"email": "test-delete-sole-comm@example.com", "password": "correct-horse", "display_name": "Sole Comm"},
        )
        created = await creator.post("/leagues", json={"name": "Test League Needs A Commissioner"})
        invite_code = created.json()["invite_code"]

        async with _client() as member:
            await member.post(
                "/auth/signup",
                json={"email": "test-delete-sole-comm-member@example.com", "password": "correct-horse", "display_name": "Regular Member"},
            )
            await member.post("/leagues/join", json={"invite_code": invite_code})

        resp = await creator.delete("/auth/me")
        assert resp.status_code == 409
        assert "Test League Needs A Commissioner" in resp.json()["detail"]


async def test_delete_account_allowed_for_sole_commissioner_with_no_other_members(pool, monkeypatch):
    """A league where the commissioner is the only member at all is
    fine to leave — there's no one else left to be locked out of
    managing it."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    async with _client() as client:
        await client.post(
            "/auth/signup",
            json={"email": "test-delete-solo-league@example.com", "password": "correct-horse", "display_name": "Solo"},
        )
        # A league this account didn't create (so the created_leagues
        # guard doesn't fire) but is the sole member/commissioner of —
        # simulated directly since there's no "join an empty league"
        # flow; the point under test is sole_commissioner_leagues alone.
        async with pool.acquire() as conn:
            other_creator = await conn.fetchval(
                "INSERT INTO users (email, password_hash, display_name) VALUES "
                "('test-delete-solo-other-creator@example.com', 'x', 'Other') RETURNING id"
            )
            league_id = await conn.fetchval(
                "INSERT INTO leagues (name, created_by_user_id, invite_code) VALUES "
                "('Test League Solo Commissioner', $1, 'SOLO-INVITE') RETURNING id",
                other_creator,
            )
            user_id = (await client.get("/auth/me")).json()["user_id"]
            await conn.execute(
                "INSERT INTO league_members (league_id, user_id, role) VALUES ($1, $2, 'commissioner')",
                league_id, user_id,
            )

        resp = await client.delete("/auth/me")
        assert resp.status_code == 204


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
