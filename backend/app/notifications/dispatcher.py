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


async def send_to_owner(conn, owner_id: int, payload: dict) -> int:
    """Sends to every active device the owner has registered — a
    notification is per-owner, not per-device; each of their devices
    gets its own independent push. Returns how many actually delivered."""
    subs = await queries.list_active_subscriptions_for_owner(conn, owner_id)
    delivered = 0
    for sub in subs:
        if await send_to_subscription(conn, sub, payload):
            delivered += 1
    return delivered


async def send_to_owners(conn, owner_ids: list[int], payload: dict) -> int:
    """Fan-out variant — e.g. every owner who rosters the player who
    just scored. Batches the subscription lookup into one query rather
    than one per owner (see queries.list_active_subscriptions_for_owners)."""
    subs = await queries.list_active_subscriptions_for_owners(conn, owner_ids)
    delivered = 0
    for sub in subs:
        if await send_to_subscription(conn, sub, payload):
            delivered += 1
    return delivered
