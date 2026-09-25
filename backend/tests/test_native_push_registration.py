"""Native (APNs/FCM) device registration — POST /push/native/register
and DELETE /push/native/register/{device_id}. The additive counterpart
to test_push_notifications.py's VAPID coverage; see
docs/NATIVE_PHASE_1_API.md for the full route design."""
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import native_push_tokens as native_queries
from app.queries import owner_preferences as preferences_queries
from app.queries import push_subscriptions as web_push_queries
from tests.conftest import make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool, owner_id: int):
    # _for_owner (not the plain make_safe_session_user_id) — resolve_owner_id
    # (app/auth/league_context.py) does a LIVE DB lookup, not a trust of the
    # JWT's own owner_id claim, so the test user actually needs owners.user_id
    # linked in the database, not just an owner_id embedded in the token.
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id_for_owner(pool, owner_id), owner_id=owner_id,
        discord_user_id=200000 + owner_id, is_commissioner=False,
    )
    return {"session": token}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-native-push-owner-{suffix}", f"Owner {suffix}",
        )


def _register_body(device_id: str, platform: str = "ios", token: str | None = None):
    return {
        "device_id": device_id,
        "platform": platform,
        "push_token": token or f"push-token-{device_id}",
        "app_version": "1.0.0",
        "os_version": "18.0",
    }


# ---- registration --------------------------------------------------------


async def test_register_requires_session():
    async with _client() as client:
        resp = await client.post("/push/native/register", json=_register_body("device-a"))
    assert resp.status_code == 401


async def test_register_creates_a_row_and_enables_push(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/push/native/register", json=_register_body("device-1"))

    assert resp.status_code == 200
    body = resp.json()
    assert body["active"] is True
    assert body["platform"] == "ios"

    async with pool.acquire() as conn:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
    assert prefs["push_enabled"] is True


async def test_register_rejects_an_invalid_platform(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 2)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/push/native/register", json=_register_body("device-2", platform="blackberry"))

    assert resp.status_code == 422


# ---- token rotation -------------------------------------------------------


async def test_reregistering_the_same_device_rotates_the_token_in_place(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 3)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        first = await client.post("/push/native/register", json=_register_body("device-3", token="old-token"))
        second = await client.post("/push/native/register", json=_register_body("device-3", token="new-token"))

    assert first.json()["id"] == second.json()["id"]

    async with pool.acquire() as conn:
        rows = await native_queries.list_active_registrations_for_owner(conn, owner_id)
    assert len(rows) == 1
    assert rows[0]["push_token"] == "new-token"


async def test_a_push_token_reassigned_to_a_different_account_is_moved_not_duplicated(pool, monkeypatch):
    """The OS can hand an identical opaque token to a reinstalled app
    now logged into a DIFFERENT account — the old (owner, device) row
    must be deactivated, not left active alongside the new one."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a = await _seed_owner(pool, "4a")
    owner_b = await _seed_owner(pool, "4b")
    shared_token = "reused-physical-device-token"

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_a))
        await client.post("/push/native/register", json=_register_body("device-4a", token=shared_token))

        client.cookies.update(await _session_cookie(pool, owner_b))
        await client.post("/push/native/register", json=_register_body("device-4b", token=shared_token))

    async with pool.acquire() as conn:
        owner_a_rows = await native_queries.list_active_registrations_for_owner(conn, owner_a)
        owner_b_rows = await native_queries.list_active_registrations_for_owner(conn, owner_b)
    assert owner_a_rows == []  # deactivated — the token moved to owner_b
    assert len(owner_b_rows) == 1
    assert owner_b_rows[0]["push_token"] == shared_token


# ---- multiple devices per owner --------------------------------------------


async def test_multiple_devices_per_owner_are_independent(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 5)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/native/register", json=_register_body("device-5-phone"))
        await client.post("/push/native/register", json=_register_body("device-5-tablet"))

        resp = await client.delete("/push/native/register/device-5-phone")
        assert resp.status_code == 204

    async with pool.acquire() as conn:
        remaining = await native_queries.list_active_registrations_for_owner(conn, owner_id)
        prefs = await preferences_queries.get_preferences(conn, owner_id)
    assert len(remaining) == 1
    assert prefs["push_enabled"] is True  # one device still active


# ---- logout / deregistration, cross-owner security -------------------------


async def test_deregister_requires_session():
    async with _client() as client:
        resp = await client.delete("/push/native/register/device-x")
    assert resp.status_code == 401


async def test_owner_can_deactivate_their_own_device(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 6)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/native/register", json=_register_body("device-6"))
        resp = await client.delete("/push/native/register/device-6")

    assert resp.status_code == 204
    async with pool.acquire() as conn:
        remaining = await native_queries.list_active_registrations_for_owner(conn, owner_id)
    assert remaining == []


async def test_owner_cannot_deactivate_another_owner_device(pool, monkeypatch):
    """Mandatory security gate: device_id ALONE must never be enough to
    deactivate a device — it must belong to the caller's own owner_id."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a = await _seed_owner(pool, "7a")
    owner_b = await _seed_owner(pool, "7b")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_a))
        await client.post("/push/native/register", json=_register_body("device-7"))

        # owner_b tries to deactivate owner_a's device by guessing its
        # device_id — must fail, never succeed just because the id is known.
        client.cookies.update(await _session_cookie(pool, owner_b))
        resp = await client.delete("/push/native/register/device-7")

    assert resp.status_code == 404
    async with pool.acquire() as conn:
        untouched = await native_queries.list_active_registrations_for_owner(conn, owner_a)
    assert len(untouched) == 1  # owner_a's device was never touched


async def test_deregistering_a_nonexistent_device_is_a_safe_404(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 8)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.delete("/push/native/register/does-not-exist")

    assert resp.status_code == 404


async def test_registration_cannot_create_ownership_ambiguity_across_owners(pool, monkeypatch):
    """Two different owners registering the SAME device_id (e.g. a
    coincidental client-generated id collision, or a shared device)
    must remain two fully independent rows — one owner's row can never
    be mutated or claimed by another owner's registration call, since
    the upsert key is (owner_id, device_id) together, not device_id
    alone."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a = await _seed_owner(pool, "9a")
    owner_b = await _seed_owner(pool, "9b")

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_a))
        await client.post(
            "/push/native/register", json=_register_body("shared-device-id", token="token-for-a")
        )
        client.cookies.update(await _session_cookie(pool, owner_b))
        await client.post(
            "/push/native/register", json=_register_body("shared-device-id", token="token-for-b")
        )

    async with pool.acquire() as conn:
        owner_a_rows = await native_queries.list_active_registrations_for_owner(conn, owner_a)
        owner_b_rows = await native_queries.list_active_registrations_for_owner(conn, owner_b)
    assert len(owner_a_rows) == 1 and owner_a_rows[0]["push_token"] == "token-for-a"
    assert len(owner_b_rows) == 1 and owner_b_rows[0]["push_token"] == "token-for-b"

    # owner_a can still deactivate exactly (and only) their own row.
    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_a))
        resp = await client.delete("/push/native/register/shared-device-id")
    assert resp.status_code == 204
    async with pool.acquire() as conn:
        owner_b_rows_after = await native_queries.list_active_registrations_for_owner(conn, owner_b)
    assert len(owner_b_rows_after) == 1  # untouched by owner_a's own deregistration


# ---- combined web + native push_enabled toggle -----------------------------


async def test_disabling_last_native_device_keeps_toggle_on_if_a_web_subscription_remains(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 10)

    async with pool.acquire() as conn:
        await web_push_queries.upsert_subscription(
            conn, owner_id, "https://push.example.com/native-combo-10", "p", "a", "Web Device"
        )

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/native/register", json=_register_body("device-10"))
        resp = await client.delete("/push/native/register/device-10")

    assert resp.status_code == 204
    async with pool.acquire() as conn:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
    assert prefs["push_enabled"] is True  # the web subscription is still active


async def test_disabling_last_web_subscription_keeps_toggle_on_if_a_native_device_remains(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 11)
    endpoint = "https://push.example.com/native-combo-11"

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/native/register", json=_register_body("device-11"))
        await client.post(
            "/push/subscribe",
            json={"endpoint": endpoint, "keys": {"p256dh": "p", "auth": "a"}, "device_label": "Web"},
        )
        resp = await client.post("/push/unsubscribe", json={"endpoint": endpoint})

    assert resp.status_code == 200
    async with pool.acquire() as conn:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
    assert prefs["push_enabled"] is True  # the native device is still active
