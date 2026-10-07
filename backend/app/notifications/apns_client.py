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

from aioapns import APNs, NotificationRequest, PushType

from app.config import require_apns_configured

logger = logging.getLogger(__name__)

# APNs' JSON error body's "reason" field (see Apple's Table 8) for a
# token that will never succeed again — anything else (rate limits,
# 5xx, a dropped connection) is worth retrying on the next event.
_PERMANENT_FAILURE_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}

_client: APNs | None = None
# Builds run straight from Xcode get APNs *sandbox* tokens; TestFlight
# and App Store builds get production ones, and each environment
# rejects the other's tokens as BadDeviceToken. Both kinds register
# against the same backend (2026-10), so a BadDeviceToken from
# production gets one retry on the sandbox before the token counts as
# gone.
_sandbox_client: APNs | None = None


def _get_client(sandbox: bool = False) -> APNs:
    global _client, _sandbox_client
    if sandbox:
        if _sandbox_client is None:
            key_id, team_id, bundle_id, key_content = require_apns_configured()
            _sandbox_client = APNs(key=key_content, key_id=key_id, team_id=team_id, topic=bundle_id, use_sandbox=True)
        return _sandbox_client
    if _client is None:
        key_id, team_id, bundle_id, key_content = require_apns_configured()
        _client = APNs(key=key_content, key_id=key_id, team_id=team_id, topic=bundle_id)
    return _client


def _reset_client_for_tests() -> None:
    """Test-only — lets a test swap in a fake client without a
    still-cached real one from an earlier test leaking through."""
    global _client, _sandbox_client
    _client = None
    _sandbox_client = None


async def send_apns(push_token: str, payload: dict) -> tuple[bool, bool]:
    """Returns (delivered, permanently_gone). payload is the shared
    {title, body, icon, badge, url, data} shape from
    app/notifications/formatter.py — icon/badge have no APNs analog
    (iOS renders the app icon itself) and are dropped; url/data ride
    alongside "aps" as custom top-level payload keys, the same way
    frontend/public/sw.js's push handler already expects them under
    the web payload's own "data"/"url" keys."""
    message = {
        # sound: without it iOS delivers silently (no buzz or tone
        # on a locked phone). thread-id groups notifications of the
        # same kind together in Notification Center.
        "aps": {
            "alert": {"title": payload.get("title", ""), "body": payload.get("body", "")},
            "sound": "default",
            "thread-id": (payload.get("data") or {}).get("type", "weekend-league"),
        },
        "url": payload.get("url"),
        "data": payload.get("data", {}),
    }
    result = await _get_client().send_notification(NotificationRequest(device_token=push_token, message=message))
    if result.is_successful:
        return True, False
    if result.description == "BadDeviceToken":
        result = await _get_client(sandbox=True).send_notification(
            NotificationRequest(device_token=push_token, message=message)
        )
        if result.is_successful:
            return True, False
    logger.warning("APNs delivery failed (status=%s, reason=%s)", result.status, result.description)
    return False, result.description in _PERMANENT_FAILURE_REASONS


async def _send_with_sandbox_retry(request_for) -> tuple[bool, bool, str | None]:
    """Shared by the two senders below: try production APNs, then the
    sandbox for a BadDeviceToken (an Xcode build), the same as send_apns.
    Returns (delivered, permanently_gone, reason)."""
    result = await _get_client().send_notification(request_for())
    if not result.is_successful and result.description == "BadDeviceToken":
        result = await _get_client(sandbox=True).send_notification(request_for())
    if result.is_successful:
        return True, False, None
    return False, result.description in _PERMANENT_FAILURE_REASONS, result.description


async def send_live_activity(push_token: str, aps: dict, priority: int = 10) -> tuple[bool, bool]:
    """A Live Activity start/update/end (2026-10). `aps` is the whole
    "aps" dict — event, timestamp, content-state, and for a start the
    attributes. Apple requires the `liveactivity` push type and the
    bundle ID's `.push-type.liveactivity` topic for these."""
    _, _, bundle_id, _ = require_apns_configured()

    def request():
        return NotificationRequest(
            device_token=push_token,
            message={"aps": aps},
            priority=priority,
            push_type=PushType.LIVEACTIVITY,
            apns_topic=f"{bundle_id}.push-type.liveactivity",
        )

    delivered, gone, reason = await _send_with_sandbox_retry(request)
    if not delivered:
        logger.warning("Live Activity push failed (reason=%s)", reason)
    return delivered, gone


async def send_background_refresh(push_token: str, data: dict) -> tuple[bool, bool]:
    """A silent push (content-available, no alert) that wakes the app in
    the background so it can refresh the home-screen widget. iOS decides
    whether and when it actually runs, and allows only a few an hour."""

    def request():
        return NotificationRequest(
            device_token=push_token,
            message={"aps": {"content-available": 1}, "data": data},
            priority=5,
            push_type=PushType.BACKGROUND,
        )

    delivered, gone, reason = await _send_with_sandbox_retry(request)
    if not delivered:
        logger.info("Background refresh push failed (reason=%s)", reason)
    return delivered, gone
