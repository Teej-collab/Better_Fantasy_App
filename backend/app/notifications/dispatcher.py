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

Quiet hours are enforced here too (send_to_owner/send_to_owners), so
no caller can forget them — see app/notifications/quiet_hours.py for
what gets sent, held, or dropped.
"""
import asyncio
import datetime
import json
import logging

from pywebpush import WebPushException, webpush

from app.config import require_vapid_configured
from app.domain import app_badge
from app.notifications import apns_client, fcm_client, formatter, quiet_hours
from app.queries import native_push_tokens as native_queries
from app.queries import owner_preferences as preferences_queries
from app.queries import push_subscriptions as queries

logger = logging.getLogger(__name__)

_PERMANENT_FAILURE_STATUS = {404, 410}
# Kinds of push whose switch is checked here rather than by each sender
# (2026-11-08): they came after Settings > Notifications was laid out.
_MUTE_PREF = {
    "trade": "notify_trades",
    "survivor_pick_needed": "notify_survivor",
    "friend": "notify_friends",
    "lounge": "notify_friends",
    **dict.fromkeys(
        ("draft_starting_soon", "draft_room_open", "draft_live", "draft_on_the_clock", "keeper_deadline_approaching", "keeper_nudge"),
        "notify_draft",
    ),
}
# How long the notification inbox keeps things.
INBOX_DAYS = 30
_NOT_KEPT = {"test", "chat_direct_message", "chat_league_message"}
# More held pushes than this for one owner go out as a single summary
# when quiet hours end, instead of a burst of separate buzzes.
_MAX_HELD_PUSHES = 3


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


async def _with_app_badges(conn, registrations, payload: dict) -> list[tuple]:
    """Pairs each native registration with its payload, carrying the
    owner's app icon number (app/domain/app_badge.py) for iPhones."""
    owner_ids = [r["owner_id"] for r in registrations if r["platform"] == "ios"]
    badges = await app_badge.totals(conn, owner_ids) if owner_ids else {}
    return [
        (r, {**payload, "app_badge": badges[r["owner_id"]]} if badges.get(r["owner_id"]) is not None else payload)
        for r in registrations
    ]


def _type(payload: dict) -> str | None:
    return (payload.get("data") or {}).get("type")


async def _muted(conn, owner_id: int, payload: dict) -> bool:
    pref = _MUTE_PREF.get(_type(payload))
    return pref is not None and not (await preferences_queries.get_preferences(conn, owner_id))[pref]


async def record(conn, payload: dict, *, owner_ids: list[int] = (), user_id: int | None = None) -> None:
    """Keeps the push in the notification inbox (GET /notifications) for
    each recipient, whether or not it reached a device. A tagged push
    replaces that recipient's earlier one with the same tag, unread
    again. Tests and admin alerts aren't kept, and neither are plain
    chat messages: the chat list already is their inbox (a mention or a
    reply to you is kept)."""
    type_ = _type(payload) or ""
    if type_ in _NOT_KEPT or type_.startswith("admin_") or not (owner_ids or user_id):
        return
    column, ids = ("owner_id", list(owner_ids)) if owner_ids else ("user_id", [user_id])
    try:
        await conn.execute(
            f"""
            INSERT INTO notifications ({column}, type, title, body, url, tag, data)
            SELECT r, $2, $3, $4, $5, $6, $7::jsonb FROM unnest($1::int[]) AS r
            ON CONFLICT ({column}, tag) WHERE {column} IS NOT NULL AND tag IS NOT NULL DO UPDATE
            SET type = EXCLUDED.type, title = EXCLUDED.title, body = EXCLUDED.body, url = EXCLUDED.url,
                data = EXCLUDED.data, created_at = now(), read_at = NULL
            """,
            ids, type_, payload.get("title") or "", payload.get("body") or "", payload.get("url") or "/",
            payload.get("tag"), json.dumps(payload.get("data") or {}),
        )
    except Exception:
        # The inbox must never stop the push itself.
        logger.warning("Couldn't keep a %s notification in the inbox", type_, exc_info=True)


async def prune_inbox(conn) -> None:
    await conn.execute("DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1)", INBOX_DAYS)


def _expired(payload: dict, now: datetime.datetime) -> bool:
    expires = (payload.get("data") or {}).get("expires")
    if not expires:
        return False
    try:
        return datetime.datetime.fromisoformat(expires) <= now
    except ValueError:
        return False


async def _quiet_hours_allow(conn, owner_id: int, payload: dict, now: datetime.datetime) -> bool:
    """True if the push can go out now. Otherwise it's held for later
    (deferred_notifications) or dropped, per quiet_hours.decide."""
    prefs = await preferences_queries.get_preferences(conn, owner_id)
    action, send_after = quiet_hours.decide(prefs, payload, now)
    if action == quiet_hours.DEFER:
        await conn.execute(
            "INSERT INTO deferred_notifications (owner_id, payload, send_after) VALUES ($1, $2::jsonb, $3)",
            owner_id, json.dumps(payload), send_after,
        )
    return action == quiet_hours.SEND


async def send_to_owner(conn, owner_id: int, payload: dict, now: datetime.datetime | None = None, *, keep: bool = True) -> int:
    """Sends to every active device the owner has registered — a
    notification is per-owner, not per-device; each of their devices
    gets its own independent push, across BOTH the web (VAPID) and
    native (APNs/FCM) channels. Returns how many actually delivered
    (0 if quiet hours held or dropped it, or its switch is off). `keep`
    puts it in the inbox; a held push going out later already is."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if await _muted(conn, owner_id, payload):
        return 0
    if keep:
        await record(conn, payload, owner_ids=[owner_id])
    if not await _quiet_hours_allow(conn, owner_id, payload, now):
        return 0
    subs = await queries.list_active_subscriptions_for_owner(conn, owner_id)
    delivered = 0
    for sub in subs:
        if await send_to_subscription(conn, sub, payload):
            delivered += 1
    native_registrations = await native_queries.list_active_registrations_for_owner(conn, owner_id)
    for registration, native_payload in await _with_app_badges(conn, native_registrations, payload):
        if await send_to_native_registration(conn, registration, native_payload):
            delivered += 1
    return delivered


async def send_to_user(conn, user_id: int, payload: dict) -> int:
    """For something that belongs to an account rather than a team (a
    survivor pool, 2026-11-07): the account's team when it has one
    (send_to_owner, quiet hours and all), else the phones and browsers it
    registered without one (user_push_tokens, user_push_subscriptions)."""
    owner_id = await conn.fetchval("SELECT owner_id FROM owner_users WHERE user_id = $1", user_id)
    if owner_id is not None:
        return await send_to_owner(conn, owner_id, payload)
    await record(conn, payload, user_id=user_id)
    delivered = 0
    for row in await conn.fetch("SELECT * FROM user_push_tokens WHERE user_id = $1 AND active", user_id):
        try:
            ok, gone = await _send_native_one(row, payload)
        except Exception:
            logger.warning("Native push delivery failed unexpectedly (user token id=%s)", row["id"], exc_info=True)
            ok, gone = False, False
        if ok:
            delivered += 1
            await conn.execute("UPDATE user_push_tokens SET last_successful_delivery_at = now() WHERE id = $1", row["id"])
        else:
            await conn.execute(
                "UPDATE user_push_tokens SET last_failure_at = now(), active = active AND NOT $2 WHERE id = $1", row["id"], gone
            )
    for row in await conn.fetch("SELECT * FROM user_push_subscriptions WHERE user_id = $1 AND active", user_id):
        try:
            ok, gone = await asyncio.to_thread(_send_one, row, payload)
        except Exception:
            logger.warning("Web push delivery failed unexpectedly (user subscription id=%s)", row["id"], exc_info=True)
            ok, gone = False, False
        if ok:
            delivered += 1
            await conn.execute("UPDATE user_push_subscriptions SET last_successful_delivery_at = now() WHERE id = $1", row["id"])
        else:
            await conn.execute(
                "UPDATE user_push_subscriptions SET last_failure_at = now(), active = active AND NOT $2 WHERE id = $1", row["id"], gone
            )
    return delivered


async def send_to_owners(conn, owner_ids: list[int], payload: dict) -> int:
    """Fan-out variant — e.g. every owner who rosters the player who
    just scored. Batches each channel's lookup into one query rather
    than one per owner (see queries.list_active_subscriptions_for_owners
    and native_queries.list_active_registrations_for_owners)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    owner_ids = [o for o in owner_ids if not await _muted(conn, o, payload)]
    await record(conn, payload, owner_ids=owner_ids)
    owner_ids = [o for o in owner_ids if await _quiet_hours_allow(conn, o, payload, now)]
    if not owner_ids:
        return 0
    subs = await queries.list_active_subscriptions_for_owners(conn, owner_ids)
    delivered = 0
    for sub in subs:
        if await send_to_subscription(conn, sub, payload):
            delivered += 1
    native_registrations = await native_queries.list_active_registrations_for_owners(conn, owner_ids)
    for registration, native_payload in await _with_app_badges(conn, native_registrations, payload):
        if await send_to_native_registration(conn, registration, native_payload):
            delivered += 1
    return delivered


async def flush_deferred(conn, now: datetime.datetime | None = None) -> int:
    """Sends every held push whose owner's quiet hours have ended.
    Rows are deleted before sending, so a failed send is never retried
    into a loop; each send still goes back through send_to_owner, so an
    owner who has since widened their quiet hours gets it held again.
    A newer push about the same thing (same tag) replaces an older one,
    one that's expired by now (a survivor pick that already locked) is
    skipped, and more than _MAX_HELD_PUSHES collapse into one summary.
    Returns how many pushes delivered."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    rows = await conn.fetch(
        "DELETE FROM deferred_notifications WHERE send_after <= $1 RETURNING id, owner_id, payload",
        now,
    )
    by_owner: dict[int, dict[str, dict]] = {}
    for row in sorted(rows, key=lambda r: r["id"]):
        payload = json.loads(row["payload"])
        if _expired(payload, now):
            continue
        by_owner.setdefault(row["owner_id"], {})[payload.get("tag") or f"id-{row['id']}"] = payload
    delivered = 0
    for owner_id, held in by_owner.items():
        payloads = list(held.values())
        if len(payloads) > _MAX_HELD_PUSHES:
            payloads = [formatter.held_player_updates(payloads)]
        for payload in payloads:
            delivered += await send_to_owner(conn, owner_id, payload, now=now, keep=False)
    return delivered
