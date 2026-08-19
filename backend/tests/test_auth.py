from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


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
        assert callback_resp.headers["location"] == "http://localhost:3000"
        assert "session" in callback_resp.cookies

        me_resp = await client.get("/auth/me")
        assert me_resp.status_code == 200
        body = me_resp.json()
        assert body["display_name"] == "Alice Smith"
        assert body["is_commissioner"] is False


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
