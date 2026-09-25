"""Native push fan-out inside app/notifications/dispatcher.py — the
additive APNs/FCM delivery alongside the existing VAPID path. See
docs/NATIVE_PHASE_1_PLAN.md workstream 1 for the design; this file
covers what test_push_notifications.py's existing VAPID-only tests
don't: dispatching to both channels for one owner, invalid/expired
native token cleanup, and confirming a native delivery failure never
breaks web delivery to the same owner in the same call."""
import app.notifications.apns_client as apns_client_module
import app.notifications.dispatcher as dispatcher_module
import app.notifications.fcm_client as fcm_client_module
from app.queries import native_push_tokens as native_queries

from tests.test_native_push_registration import _register_body, _seed_owner


async def _register_device(client_helper, pool, owner_id, device_id, platform="ios", token=None):
    from httpx import ASGITransport, AsyncClient
    from app.auth.session import create_session_token
    from app.main import app
    from tests.conftest import make_safe_session_user_id_for_owner

    # _for_owner — resolve_owner_id does a live DB lookup, not a trust of
    # the JWT's own owner_id claim (see test_native_push_registration.py's
    # _session_cookie for the same note).
    session_token = create_session_token(
        "test-secret-thats-at-least-32-bytes-long",
        user_id=await make_safe_session_user_id_for_owner(pool, owner_id), owner_id=owner_id,
        discord_user_id=300000 + owner_id, is_commissioner=False,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.update({"session": session_token})
        resp = await client.post(
            "/push/native/register", json=_register_body(device_id, platform=platform, token=token)
        )
    assert resp.status_code == 200
    return resp.json()


async def test_send_to_owner_delivers_to_both_web_and_native_channels(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    import app.config as config_module
    monkeypatch.setattr(config_module, "VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(config_module, "VAPID_PRIVATE_KEY", "test-private")
    monkeypatch.setattr(config_module, "VAPID_SUBJECT", "mailto:test@example.com")

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        pass

    monkeypatch.setattr(dispatcher_module, "webpush", fake_webpush)

    apns_calls = []

    async def fake_send_apns(push_token, payload):
        apns_calls.append(push_token)
        return True, False

    monkeypatch.setattr(apns_client_module, "send_apns", fake_send_apns)

    owner_id = await _seed_owner(pool, "dispatch-1")
    await _register_device(None, pool, owner_id, "dispatch-device-1", token="apns-token-1")

    from app.queries import push_subscriptions as web_queries
    async with pool.acquire() as conn:
        await web_queries.upsert_subscription(
            conn, owner_id, "https://push.example.com/dispatch-1", "p", "a", "Web Device"
        )
        delivered = await dispatcher_module.send_to_owner(conn, owner_id, {"title": "x", "body": "y"})

    assert delivered == 2
    assert apns_calls == ["apns-token-1"]


async def test_apns_permanent_failure_deactivates_the_registration(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")

    async def fake_send_apns(push_token, payload):
        return False, True  # e.g. BadDeviceToken

    monkeypatch.setattr(apns_client_module, "send_apns", fake_send_apns)

    owner_id = await _seed_owner(pool, "dispatch-2")
    await _register_device(None, pool, owner_id, "dispatch-device-2", token="apns-token-2")

    async with pool.acquire() as conn:
        delivered = await dispatcher_module.send_to_owner(conn, owner_id, {"title": "x", "body": "y"})
        remaining = await native_queries.list_active_registrations_for_owner(conn, owner_id)

    assert delivered == 0
    assert remaining == []  # deactivated, not left to be retried forever


async def test_apns_transient_failure_keeps_the_registration_active(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")

    async def fake_send_apns(push_token, payload):
        return False, False  # e.g. a rate limit or 5xx

    monkeypatch.setattr(apns_client_module, "send_apns", fake_send_apns)

    owner_id = await _seed_owner(pool, "dispatch-3")
    await _register_device(None, pool, owner_id, "dispatch-device-3", token="apns-token-3")

    async with pool.acquire() as conn:
        delivered = await dispatcher_module.send_to_owner(conn, owner_id, {"title": "x", "body": "y"})
        remaining = await native_queries.list_active_registrations_for_owner(conn, owner_id)

    assert delivered == 0
    assert len(remaining) == 1  # still active — worth retrying next time


async def test_fcm_permanent_failure_deactivates_the_registration(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")

    async def fake_send_fcm(push_token, payload):
        return False, True  # e.g. UNREGISTERED

    monkeypatch.setattr(fcm_client_module, "send_fcm", fake_send_fcm)

    owner_id = await _seed_owner(pool, "dispatch-4")
    await _register_device(None, pool, owner_id, "dispatch-device-4", platform="android", token="fcm-token-4")

    async with pool.acquire() as conn:
        delivered = await dispatcher_module.send_to_owner(conn, owner_id, {"title": "x", "body": "y"})
        remaining = await native_queries.list_active_registrations_for_owner(conn, owner_id)

    assert delivered == 0
    assert remaining == []


async def test_native_delivery_failure_does_not_break_web_delivery_to_the_same_owner(pool, monkeypatch):
    """The one requirement dispatcher.py's own module docstring already
    states for web push — a push failure must never break the feature
    that triggered it — must hold across channels too: an unconfigured/
    erroring native provider must not prevent web (VAPID) delivery to
    the same owner in the same send_to_owner call."""
    monkeypatch.setenv("SESSION_SECRET", "test-secret-thats-at-least-32-bytes-long")
    import app.config as config_module
    monkeypatch.setattr(config_module, "VAPID_PUBLIC_KEY", "test-public")
    monkeypatch.setattr(config_module, "VAPID_PRIVATE_KEY", "test-private")
    monkeypatch.setattr(config_module, "VAPID_SUBJECT", "mailto:test@example.com")

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        pass

    monkeypatch.setattr(dispatcher_module, "webpush", fake_webpush)

    async def raising_send_apns(push_token, payload):
        raise RuntimeError("Native iOS push isn't configured")

    monkeypatch.setattr(apns_client_module, "send_apns", raising_send_apns)

    owner_id = await _seed_owner(pool, "dispatch-5")
    await _register_device(None, pool, owner_id, "dispatch-device-5", token="apns-token-5")

    from app.queries import push_subscriptions as web_queries
    async with pool.acquire() as conn:
        await web_queries.upsert_subscription(
            conn, owner_id, "https://push.example.com/dispatch-5", "p", "a", "Web Device"
        )
        # Must not raise — the native failure is swallowed, web still delivers.
        delivered = await dispatcher_module.send_to_owner(conn, owner_id, {"title": "x", "body": "y"})

    assert delivered == 1  # web succeeded; native failed but didn't take the call down
