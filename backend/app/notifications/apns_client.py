"""
Thin wrapper around aioapns for sending to a single iOS device token —
the native counterpart to pywebpush in app/notifications/dispatcher.py.
Returns the same (delivered, permanently_gone) shape dispatcher.py's
own _send_one already uses for VAPID, so send_to_native_registration
can treat every channel identically (see that module's docstring).

aioapns signs its own provider-auth JWT (ES256, from
app.config.require_apns_configured's key content) and caches/reuses one
persistent HTTP/2 connection across calls — this module keeps exactly
one APNs client for the process lifetime rather than reconnecting per
notification.
"""
import logging

from aioapns import APNs, NotificationRequest

from app.config import require_apns_configured

logger = logging.getLogger(__name__)

# APNs' JSON error body's "reason" field (see Apple's Table 8) for a
# token that will never succeed again — anything else (rate limits,
# 5xx, a dropped connection) is worth retrying on the next event.
_PERMANENT_FAILURE_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}

_client: APNs | None = None


def _get_client() -> APNs:
    global _client
    if _client is None:
        key_id, team_id, bundle_id, key_content = require_apns_configured()
        _client = APNs(key=key_content, key_id=key_id, team_id=team_id, topic=bundle_id)
    return _client


def _reset_client_for_tests() -> None:
    """Test-only — lets a test swap in a fake client without a
    still-cached real one from an earlier test leaking through."""
    global _client
    _client = None


async def send_apns(push_token: str, payload: dict) -> tuple[bool, bool]:
    """Returns (delivered, permanently_gone). payload is the shared
    {title, body, icon, badge, url, data} shape from
    app/notifications/formatter.py — icon/badge have no APNs analog
    (iOS renders the app icon itself) and are dropped; url/data ride
    alongside "aps" as custom top-level payload keys, the same way
    frontend/public/sw.js's push handler already expects them under
    the web payload's own "data"/"url" keys."""
    client = _get_client()
    request = NotificationRequest(
        device_token=push_token,
        message={
            "aps": {"alert": {"title": payload.get("title", ""), "body": payload.get("body", "")}},
            "url": payload.get("url"),
            "data": payload.get("data", {}),
        },
    )
    result = await client.send_notification(request)
    if result.is_successful:
        return True, False
    logger.warning("APNs delivery failed (status=%s, reason=%s)", result.status, result.description)
    return False, result.description in _PERMANENT_FAILURE_REASONS
