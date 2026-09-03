from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import owner_preferences as preferences_queries
from tests.conftest import make_safe_session_user_id
from app.queries import push_subscriptions as queries

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id(pool), owner_id=owner_id, discord_user_id=100000 + owner_id, is_commissioner=False
    )
    return {"session": token}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-push-owner-{suffix}", f"Owner {suffix}",
        )


def _sub_body(suffix: str, device: str = "Test Device"):
    return {
        "endpoint": f"https://push.example.com/subscription/{suffix}",
        "keys": {"p256dh": f"p256dh-{suffix}", "auth": f"auth-{suffix}"},
        "device_label": device,
    }


# ---- subscribe / unsubscribe ------------------------------------------------


async def test_subscribe_requires_session():
    async with _client() as client:
        resp = await client.post("/push/subscribe", json=_sub_body("a"))
    assert resp.status_code == 401


async def test_subscribe_creates_a_row_and_enables_push(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/push/subscribe", json=_sub_body("owner1"))

    assert resp.status_code == 200
    assert resp.json()["active"] is True

    async with pool.acquire() as conn:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
    assert prefs["push_enabled"] is True


async def test_resubscribing_the_same_endpoint_upserts_not_duplicates(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 2)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        first = await client.post("/push/subscribe", json=_sub_body("owner2"))
        second = await client.post("/push/subscribe", json=_sub_body("owner2", device="Updated Label"))

    assert first.json()["id"] == second.json()["id"]
    assert second.json()["device_label"] == "Updated Label"

    async with pool.acquire() as conn:
        rows = await queries.list_active_subscriptions_for_owner(conn, owner_id)
    assert len(rows) == 1


async def test_unsubscribe_requires_session():
    async with _client() as client:
        resp = await client.post("/push/unsubscribe", json={"endpoint": "https://push.example.com/x"})
    assert resp.status_code == 401


async def test_unsubscribe_only_affects_the_caller_own_subscription(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a = await _seed_owner(pool, 3)
    owner_b = await _seed_owner(pool, 4)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_a))
        await client.post("/push/subscribe", json=_sub_body("owner3"))

        # owner_b tries to unsubscribe owner_a's endpoint — must fail,
        # never succeed just because the endpoint string is known.
        client.cookies.update(await _session_cookie(pool, owner_b))
        resp = await client.post("/push/unsubscribe", json={"endpoint": _sub_body("owner3")["endpoint"]})

    assert resp.status_code == 404
    async with pool.acquire() as conn:
        rows = await queries.list_active_subscriptions_for_owner(conn, owner_a)
    assert len(rows) == 1  # untouched


async def test_multi_device_disabling_one_leaves_the_other_active(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 5)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/subscribe", json=_sub_body("owner5-iphone"))
        await client.post("/push/subscribe", json=_sub_body("owner5-mac"))

        resp = await client.post("/push/unsubscribe", json={"endpoint": _sub_body("owner5-iphone")["endpoint"]})
        assert resp.status_code == 200

    async with pool.acquire() as conn:
        remaining = await queries.list_active_subscriptions_for_owner(conn, owner_id)
        prefs = await preferences_queries.get_preferences(conn, owner_id)

    assert len(remaining) == 1
    assert remaining[0]["endpoint"] == _sub_body("owner5-mac")["endpoint"]
    # Still has one active device — the master toggle must stay on.
    assert prefs["push_enabled"] is True


async def test_disabling_every_device_turns_off_the_master_toggle(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 6)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/subscribe", json=_sub_body("owner6"))
        await client.post("/push/unsubscribe", json={"endpoint": _sub_body("owner6")["endpoint"]})

    async with pool.acquire() as conn:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
    assert prefs["push_enabled"] is False


async def test_subscribe_rejects_missing_fields(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 7)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/push/subscribe", json={"endpoint": "", "keys": {"p256dh": "", "auth": ""}}
        )
    assert resp.status_code == 400


# ---- test-notification endpoint ---------------------------------------------


async def test_send_test_notification_requires_an_active_subscription(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 8)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/push/test")
    assert resp.status_code == 400


async def test_send_test_notification_delivers_to_own_subscriptions_only(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "test-private")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.com")
    # Reload the module-level config values the dispatcher reads —
    # app/config.py reads env once at import time via os.getenv, so a
    # monkeypatched env var alone won't reach it; patch the already-
    # imported names directly instead (same approach other tests in
    # this suite use for env-driven config).
    import app.config as config_module

    monkeypatch.setattr(config_module, "VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(config_module, "VAPID_PRIVATE_KEY", "test-private")
    monkeypatch.setattr(config_module, "VAPID_SUBJECT", "mailto:test@example.com")

    sent = []

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        sent.append(subscription_info["endpoint"])

    import app.notifications.dispatcher as dispatcher_module

    monkeypatch.setattr(dispatcher_module, "webpush", fake_webpush)

    owner_id = await _seed_owner(pool, 9)
    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        await client.post("/push/subscribe", json=_sub_body("owner9"))
        resp = await client.post("/push/test")

    assert resp.status_code == 200
    body = resp.json()
    assert body["attempted"] == 1
    assert body["delivered"] == 1
    assert sent == [_sub_body("owner9")["endpoint"]]

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT last_successful_delivery_at FROM push_subscriptions WHERE owner_id = $1", owner_id
        )
    assert row["last_successful_delivery_at"] is not None


async def test_delivery_failure_marks_subscription_inactive_when_permanently_gone(pool, monkeypatch):
    import app.config as config_module

    monkeypatch.setattr(config_module, "VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(config_module, "VAPID_PRIVATE_KEY", "test-private")
    monkeypatch.setattr(config_module, "VAPID_SUBJECT", "mailto:test@example.com")

    import app.notifications.dispatcher as dispatcher_module
    from pywebpush import WebPushException

    class _FakeResponse:
        status_code = 410

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        raise WebPushException("gone", response=_FakeResponse())

    monkeypatch.setattr(dispatcher_module, "webpush", fake_webpush)

    owner_id = await _seed_owner(pool, 10)
    async with pool.acquire() as conn:
        row = await queries.upsert_subscription(
            conn, owner_id, _sub_body("owner10")["endpoint"], "p", "a", "Test"
        )
        delivered = await dispatcher_module.send_to_owner(conn, owner_id, {"title": "x", "body": "y"})

    assert delivered == 0
    async with pool.acquire() as conn:
        active = await queries.list_active_subscriptions_for_owner(conn, owner_id)
    assert active == []  # deactivated, not left active to be retried forever
