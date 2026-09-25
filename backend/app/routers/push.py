"""
Web Push subscription lifecycle — subscribe/unsubscribe/test. Same
session-only-auth discipline as app/routers/settings.py: every route
resolves the owner from the session cookie, never from a client-
supplied id, so there's no request shape that lets one owner register
or delete another's subscription.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import resolve_owner_id
from app.auth.session import decode_session_token, get_session_token
from app.config import VAPID_PUBLIC_KEY
from app.db import get_pool
from app.notifications import dispatcher, formatter
from app.queries import native_push_tokens as native_queries
from app.queries import owner_preferences as preferences_queries
from app.queries import push_subscriptions as queries

router = APIRouter(prefix="/push", tags=["push"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.get("/vapid-public-key")
async def vapid_public_key():
    """Public by design — this is the whole point of the public half of
    a VAPID keypair; the frontend needs it to call
    PushManager.subscribe(). The private key never leaves the backend
    (app/config.py, app/notifications/dispatcher.py)."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push notifications aren't configured on this server")
    return {"public_key": VAPID_PUBLIC_KEY}


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: SubscriptionKeys
    # Best-effort human label ("Chrome on iPhone") — cosmetic only, for
    # a future "manage your devices" list; never trusted for anything
    # security-relevant.
    device_label: str | None = None


@router.post("/subscribe")
async def subscribe(body: SubscribeBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    if not body.endpoint or not body.keys.p256dh or not body.keys.auth:
        raise HTTPException(status_code=400, detail="endpoint and keys are required")

    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        row = await queries.upsert_subscription(
            conn, owner_id, body.endpoint, body.keys.p256dh, body.keys.auth, body.device_label
        )
        # update_preferences (not a raw UPDATE) — owner_preferences rows
        # are created lazily on first write, so a bare UPDATE would
        # silently affect zero rows for an owner who's never touched
        # any preference before now.
        await preferences_queries.update_preferences(conn, owner_id, {"push_enabled": True})
    return {"id": row["id"], "device_label": row["device_label"], "active": row["active"]}


class UnsubscribeBody(BaseModel):
    endpoint: str


async def _has_any_active_channel(conn, owner_id: int) -> bool:
    """True if this owner still has at least one active subscription on
    EITHER channel — web (VAPID) or native (APNs/FCM). Used by both
    /push/unsubscribe and /push/native/register/{device_id} so removing
    your last device on one channel never turns off the master toggle
    while the other channel still has an active device."""
    remaining = await queries.list_active_subscriptions_for_owner(conn, owner_id)
    if remaining:
        return True
    return await native_queries.has_any_active_registration(conn, owner_id)


@router.post("/unsubscribe")
async def unsubscribe(body: UnsubscribeBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        found = await queries.deactivate_subscription(conn, owner_id, body.endpoint)
        if not found:
            raise HTTPException(status_code=404, detail="No matching subscription for this account")
        if not await _has_any_active_channel(conn, owner_id):
            # Only flip the master toggle off once literally every
            # device on every channel is gone — disabling on one device
            # must never disable notifications on the others still
            # subscribed, web or native.
            await preferences_queries.update_preferences(conn, owner_id, {"push_enabled": False})
    return {"ok": True}


class NativeRegisterBody(BaseModel):
    device_id: str
    platform: str
    push_token: str
    app_version: str | None = None
    os_version: str | None = None


@router.post("/native/register")
async def register_native_device(body: NativeRegisterBody, request: Request, pool=Depends(get_pool)):
    """Native (APNs/FCM) counterpart to /push/subscribe above — same
    session-only-auth discipline, same "owner_id always resolved
    server-side, never client-supplied" rule."""
    payload = _require_session(request)
    if body.platform not in ("ios", "android"):
        raise HTTPException(status_code=422, detail="platform must be ios or android")
    if not body.device_id or not body.push_token:
        raise HTTPException(status_code=400, detail="device_id and push_token are required")

    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        if owner_id is None:
            raise HTTPException(status_code=409, detail="No league yet — join or create one first")
        row = await native_queries.upsert_registration(
            conn, owner_id, body.device_id, body.platform, body.push_token, body.app_version, body.os_version
        )
        # Same "always reflects reality" reasoning as /push/subscribe's
        # own push_enabled write above.
        await preferences_queries.update_preferences(conn, owner_id, {"push_enabled": True})
    return {"id": row["id"], "device_id": row["device_id"], "platform": row["platform"], "active": row["active"]}


@router.delete("/native/register/{device_id}")
async def deregister_native_device(device_id: str, request: Request, pool=Depends(get_pool)):
    """Native counterpart to /push/unsubscribe above. Scoped to
    (owner_id, device_id) from the session — never device_id alone —
    so one owner can never deactivate another owner's device by
    guessing/reusing a device_id. This is the one route in this
    workstream where getting that scoping wrong would be a real
    cross-account authorization bug, not just a data-quality one."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        found = await native_queries.deactivate_registration(conn, owner_id, device_id)
        if not found:
            raise HTTPException(status_code=404, detail="No matching device for this account")
        if not await _has_any_active_channel(conn, owner_id):
            await preferences_queries.update_preferences(conn, owner_id, {"push_enabled": False})
    return Response(status_code=204)


@router.post("/test")
async def send_test_notification(request: Request, pool=Depends(get_pool)):
    """Dev/verification tool, not a public broadcast endpoint — only
    ever sends to the CALLER's own active subscriptions, gated behind
    the same session auth as everything else here. Safe to leave
    reachable in production for exactly this reason (per the "no
    unrestricted public notification-sending endpoint" requirement —
    this one is restricted to sending to yourself)."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        subs = await queries.list_active_subscriptions_for_owner(conn, owner_id)
        if not subs:
            raise HTTPException(status_code=400, detail="No active push subscriptions on this account")
        delivered = await dispatcher.send_to_owner(conn, owner_id, formatter.test_notification())
    return {"delivered": delivered, "attempted": len(subs)}
