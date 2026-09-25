from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.db import get_pool
from app.encryption import decrypt_secret, encrypt_secret
from app.main import app
from tests.fakes_espn import FakeLeague


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


async def _sign_up(client: AsyncClient, email: str, display_name: str = "Test Person"):
    resp = await client.post(
        "/auth/signup", json={"email": email, "password": "correct-horse", "display_name": display_name}
    )
    assert resp.status_code == 200


def _mock_league_success(monkeypatch, current_week=3):
    monkeypatch.setattr(
        "app.providers.espn.adapter.League", lambda **kwargs: FakeLeague(current_week=current_week)
    )


def _mock_league_failure(monkeypatch):
    def _raise(**kwargs):
        raise Exception("ESPN rejected this request (401)")

    monkeypatch.setattr("app.providers.espn.adapter.League", _raise)


# --- app/encryption.py -------------------------------------------------


def test_encrypt_decrypt_round_trip(monkeypatch):
    # app.config.ESPN_CREDENTIAL_ENCRYPTION_KEY is a module-level
    # constant, frozen at import time (same pattern as VAPID_PUBLIC_KEY/
    # APNS_KEY_ID/FCM_SERVICE_ACCOUNT_JSON) — monkeypatch.setenv alone
    # wouldn't reach it (require_espn_credential_encryption_configured
    # reads the already-imported module attribute, not a fresh
    # os.getenv() call), so the attribute itself has to be patched.
    monkeypatch.setattr("app.config.ESPN_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    ciphertext = encrypt_secret("my-real-espn-s2-cookie")
    assert ciphertext != "my-real-espn-s2-cookie"
    assert decrypt_secret(ciphertext) == "my-real-espn-s2-cookie"


def test_decrypt_with_wrong_key_raises_a_clear_error(monkeypatch):
    monkeypatch.setattr("app.config.ESPN_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    ciphertext = encrypt_secret("secret")
    monkeypatch.setattr("app.config.ESPN_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    try:
        decrypt_secret(ciphertext)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "encryption key" in str(e)


# --- GET/POST/DELETE /league/espn-connection ----------------------------


async def test_get_espn_connection_requires_session():
    async with _client() as client:
        resp = await client.get("/league/espn-connection")
    assert resp.status_code == 401


async def test_get_espn_connection_when_not_connected(pool):
    async with _client() as client:
        await _sign_up(client, "test-espn-none@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN None"})
        resp = await client.get("/league/espn-connection")
    assert resp.status_code == 200
    assert resp.json() == {"connected": False}


async def test_connect_espn_requires_commissioner(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as creator:
        await _sign_up(creator, "test-espn-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League ESPN Unauth"})
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-espn-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.post(
            "/league/espn-connection",
            json={"espn_league_id": 999999, "espn_s2": "s2-value", "espn_swid": "{SWID-VALUE}"},
        )
    assert resp.status_code == 403


async def test_connect_espn_rejects_bad_credentials(pool, monkeypatch):
    _mock_league_failure(monkeypatch)
    async with _client() as client:
        await _sign_up(client, "test-espn-bad-creds@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Bad Creds"})
        connect_resp = await client.post(
            "/league/espn-connection",
            json={"espn_league_id": 999999, "espn_s2": "wrong", "espn_swid": "{wrong}"},
        )
        status_resp = await client.get("/league/espn-connection")
    assert connect_resp.status_code == 400
    # A rejected connect attempt must never leave a half-saved row behind.
    assert status_resp.json() == {"connected": False}


async def test_connect_espn_succeeds_and_encrypts_credentials_at_rest(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as client:
        await _sign_up(client, "test-espn-connect@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Connect"})
        connect_resp = await client.post(
            "/league/espn-connection",
            json={"espn_league_id": 424242, "espn_s2": "the-real-s2-cookie-value", "espn_swid": "{REAL-SWID}"},
        )
        status_resp = await client.get("/league/espn-connection")
    assert connect_resp.status_code == 200
    assert connect_resp.json() == {"connected": True, "espn_league_id": 424242}
    body = status_resp.json()
    assert body["connected"] is True
    assert body["espn_league_id"] == 424242
    assert body["last_synced_at"] is None
    assert "espn_s2" not in body and "espn_swid" not in body

    pool_ = await get_pool()
    async with pool_.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT espn_s2_encrypted, espn_swid_encrypted FROM league_espn_connections "
            "WHERE league_id = (SELECT id FROM leagues WHERE name = 'Test League ESPN Connect')"
        )
    assert "the-real-s2-cookie-value" not in row["espn_s2_encrypted"]
    assert decrypt_secret(row["espn_s2_encrypted"]) == "the-real-s2-cookie-value"
    assert decrypt_secret(row["espn_swid_encrypted"]) == "{REAL-SWID}"


async def test_reconnecting_replaces_credentials_and_clears_prior_sync_error(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as client:
        await _sign_up(client, "test-espn-reconnect@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Reconnect"})
        await client.post(
            "/league/espn-connection",
            json={"espn_league_id": 1, "espn_s2": "first", "espn_swid": "{first}"},
        )

        pool_ = await get_pool()
        async with pool_.acquire() as conn:
            league_id = await conn.fetchval("SELECT id FROM leagues WHERE name = 'Test League ESPN Reconnect'")
            await conn.execute(
                "UPDATE league_espn_connections SET last_sync_error = 'stale failure' WHERE league_id = $1",
                league_id,
            )

        await client.post(
            "/league/espn-connection",
            json={"espn_league_id": 2, "espn_s2": "second", "espn_swid": "{second}"},
        )
        status_resp = await client.get("/league/espn-connection")
    body = status_resp.json()
    assert body["espn_league_id"] == 2
    assert body["last_sync_error"] is None


async def test_disconnect_requires_commissioner(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as creator:
        await _sign_up(creator, "test-espn-disconnect-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League ESPN Disconnect Unauth"})
        invite_code = created.json()["invite_code"]
        await creator.post(
            "/league/espn-connection", json={"espn_league_id": 1, "espn_s2": "s2", "espn_swid": "{swid}"}
        )

    async with _client() as member:
        await _sign_up(member, "test-espn-disconnect-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.delete("/league/espn-connection")
    assert resp.status_code == 403


async def test_disconnect_removes_the_connection(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as client:
        await _sign_up(client, "test-espn-disconnect@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Disconnect"})
        await client.post(
            "/league/espn-connection", json={"espn_league_id": 1, "espn_s2": "s2", "espn_swid": "{swid}"}
        )
        delete_resp = await client.delete("/league/espn-connection")
        status_resp = await client.get("/league/espn-connection")
    assert delete_resp.status_code == 204
    assert status_resp.json() == {"connected": False}


# --- POST /league/espn-connection/sync -----------------------------------


async def test_sync_requires_an_existing_connection(pool):
    async with _client() as client:
        await _sign_up(client, "test-espn-sync-none@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Sync None"})
        resp = await client.post("/league/espn-connection/sync")
    assert resp.status_code == 409


async def test_sync_requires_commissioner(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as creator:
        await _sign_up(creator, "test-espn-sync-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League ESPN Sync Unauth"})
        invite_code = created.json()["invite_code"]
        await creator.post(
            "/league/espn-connection", json={"espn_league_id": 1, "espn_s2": "s2", "espn_swid": "{swid}"}
        )

    async with _client() as member:
        await _sign_up(member, "test-espn-sync-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.post("/league/espn-connection/sync")
    assert resp.status_code == 403


async def test_sync_runs_with_this_leagues_own_league_id_and_marks_success(pool, monkeypatch):
    _mock_league_success(monkeypatch)

    captured = {}

    async def fake_run_full_sync(provider, start_season, end_season, league_id):
        captured["config_league_id"] = provider.config.league_id
        captured["config_s2"] = provider.config.espn_s2
        captured["app_league_id"] = league_id
        return {start_season: {"teams": {"status": "success", "count": 10}}}

    monkeypatch.setattr("app.routers.league_settings.run_full_sync", fake_run_full_sync)

    async with _client() as client:
        await _sign_up(client, "test-espn-sync-success@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Sync Success"})
        await client.post(
            "/league/espn-connection",
            json={"espn_league_id": 555, "espn_s2": "a-real-cookie", "espn_swid": "{a-real-swid}"},
        )
        sync_resp = await client.post("/league/espn-connection/sync")
        status_resp = await client.get("/league/espn-connection")

        pool_ = await get_pool()
        async with pool_.acquire() as conn:
            app_league_id = await conn.fetchval(
                "SELECT id FROM leagues WHERE name = 'Test League ESPN Sync Success'"
            )
    assert sync_resp.status_code == 200
    assert captured["config_league_id"] == 555
    assert captured["config_s2"] == "a-real-cookie"
    assert captured["app_league_id"] == app_league_id
    assert status_resp.json()["last_synced_at"] is not None
    assert status_resp.json()["last_sync_error"] is None


async def test_sync_marks_failure_when_the_teams_step_fails(pool, monkeypatch):
    _mock_league_success(monkeypatch)

    async def fake_run_full_sync(provider, start_season, end_season, league_id):
        return {start_season: {"teams": {"status": "failed", "detail": "ESPN session expired"}}}

    monkeypatch.setattr("app.routers.league_settings.run_full_sync", fake_run_full_sync)

    async with _client() as client:
        await _sign_up(client, "test-espn-sync-failure@example.com")
        await client.post("/leagues", json={"name": "Test League ESPN Sync Failure"})
        await client.post(
            "/league/espn-connection", json={"espn_league_id": 1, "espn_s2": "s2", "espn_swid": "{swid}"}
        )
        await client.post("/league/espn-connection/sync")
        status_resp = await client.get("/league/espn-connection")
    body = status_resp.json()
    assert body["last_sync_error"] == "ESPN session expired"
    # Never synced successfully, so last_synced_at stays null.
    assert body["last_synced_at"] is None


# --- Isolation -------------------------------------------------------------


async def test_two_leagues_espn_connections_are_fully_isolated(pool, monkeypatch):
    _mock_league_success(monkeypatch)
    async with _client() as league_a:
        await _sign_up(league_a, "test-espn-isolation-a@example.com")
        await league_a.post("/leagues", json={"name": "Test League ESPN Isolation A"})
        await league_a.post(
            "/league/espn-connection", json={"espn_league_id": 111, "espn_s2": "a-s2", "espn_swid": "{a}"}
        )

    async with _client() as league_b:
        await _sign_up(league_b, "test-espn-isolation-b@example.com")
        await league_b.post("/leagues", json={"name": "Test League ESPN Isolation B"})
        status_resp = await league_b.get("/league/espn-connection")
    assert status_resp.json() == {"connected": False}
