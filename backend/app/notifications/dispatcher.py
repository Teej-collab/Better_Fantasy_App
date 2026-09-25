"""
The one place that actually talks to a push provider (via pywebpush/
VAPID). Everything upstream of this — Gamecast, chat, future league/
trade/waiver events — only ever needs to know a NotificationPayload and
which owner_ids should receive it; nothing above this layer imports
pywebpush or touches a raw subscription row. See app/notifications/
formatter.py for building payloads and app/notifications/events.py for
the dedup/preference/rate-limit pipeline that decides WHO gets one —
this module's only job is actually sending, once that's decided.

A push failure must never break the feature that triggered it (a
touchdown notification failing to send is not a reason to interrupt
Gamecast) — every public function here swallows and logs delivery
errors per-subscription rather than raising, and marks the offending
subscription inactive if the provider says it's permanently gone
(410/404) so the dispatcher stops wasting calls on a dead endpoint.
"""
import asyncio
import json
import logging

from pywebpush import WebPushException, webpush

from app.config import require_vapid_configured
from app.notifications import apns_client, fcm_client
from app.queries import native_push_tokens as native_queries
from app.queries import push_subscriptions as queries

logger = logging.getLogger(__name__)

_PERMANENT_FAILURE_STATUS = {404, 410}


def _send_one(subscription_row, payload: dict) -> tuple[bool, bool]:
    """Returns (delivered, permanently_gone). Synchronous — pywebpush
    itself is a blocking HTTP call (no async client available), so
    callers run this via asyncio.to_thread rather than blocking the
    event loop directly."""
    public_key, private_key, subject = require_vapid_configured()
    try:
        webpush(
            subscription_info={
                "endpoint": subscription_row["endpoint"],
                "keys": {"p256dh": subscription_row["p256dh"], "auth": subscription_row["auth"]},
            },
            data=json.dumps(payload),
            vapid_private_key=private_key,
            vapid_claims={"sub": subject},
        )
        return True, False
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        # Never log the endpoint/keys themselves — they're bearer
        # credentials for pushing to this exact device.
        logger.warning("Push delivery failed (subscription id=%s, status=%s)", subscription_row["id"], status)
        return False, status in _PERMANENT_FAILURE_STATUS


async def send_to_subscription(conn, subscription_row, payload: dict) -> bool:
    delivered, permanently_gone = await asyncio.to_thread(_send_one, subscription_row, payload)
    if delivered:
        await queries.mark_delivery_success(conn, subscription_row["id"])
    else:
        await queries.mark_delivery_failed(conn, subscription_row["id"], permanent=permanently_gone)
    return delivered


async def _send_native_one(registration_row, payload: dict) -> tuple[bool, bool]:
    """Returns (delivered, permanently_gone) — routes to APNs or FCM
    based on the registration's own platform column. Same contract as
    _send_one above, so send_to_native_registration can treat every
    channel identically."""
    if registration_row["platform"] == "ios":
        return await apns_client.send_apns(registration_row["push_token"], payload)
    return await fcm_client.send_fcm(registration_row["push_token"], payload)


async def send_to_native_registration(conn, registration_row, payload: dict) -> bool:
    """Native (APNs/FCM) counterpart to send_to_subscription above.
    Catches broadly, not just a specific provider exception the way
    _send_one does for pywebpush's WebPushException — APNs/FCM being
    unconfigured (RuntimeError from app.config.require_apns_configured/
    require_fcm_configured) or a raw network error are both real
    possibilities for this newer, less-exercised delivery path, and
    neither should ever take down web push delivery to the SAME owner
    in the SAME send_to_owner(s) call (see this module's own docstring:
    a push failure must never break the feature that triggered it)."""
    try:
        delivered, permanently_gone = await _send_native_one(registration_row, payload)
    except Exception:
        logger.warning(
            "Native push delivery failed unexpectedly (registration id=%s)",
            registration_row["id"], exc_info=True,
        )
        await native_queries.mark_delivery_failed(conn, registration_row["id"], permanent=False)
        return False
    if delivered:
        await native_queries.mark_delivery_success(conn, registration_row["id"])
    else:
        await native_queries.mark_delivery_failed(conn, registration_row["id"], permanent=permanently_gone)
    return delivered


async def send_to_owner(conn, owner_id: int, payload: dict) -> int:
    """Sends to every active device the owner has registered — a
    notification is per-owner, not per-device; each of their devices
    gets its own independent push, across BOTH the web (VAPID) and
    native (APNs/FCM) channels. Returns how many actually delivered."""
    subs = await queries.list_active_subscriptions_for_owner(conn, owner_id)
    delivered = 0
    for sub in subs:
        if await send_to_subscription(conn, sub, payload):
            delivered += 1
    native_registrations = await native_queries.list_active_registrations_for_owner(conn, owner_id)
    for registration in native_registrations:
        if await send_to_native_registration(conn, registration, payload):
            delivered += 1
    return delivered


async def send_to_owners(conn, owner_ids: list[int], payload: dict) -> int:
    """Fan-out variant — e.g. every owner who rosters the player who
    just scored. Batches each channel's lookup into one query rather
    than one per owner (see queries.list_active_subscriptions_for_owners
    and native_queries.list_active_registrations_for_owners)."""
    subs = await queries.list_active_subscriptions_for_owners(conn, owner_ids)
    delivered = 0
    for sub in subs:
        if await send_to_subscription(conn, sub, payload):
            delivered += 1
    native_registrations = await native_queries.list_active_registrations_for_owners(conn, owner_ids)
    for registration in native_registrations:
        if await send_to_native_registration(conn, registration, payload):
            delivered += 1
    return delivered
