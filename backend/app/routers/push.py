"""
Web Push subscription lifecycle — subscribe/unsubscribe/test. Same
session-only-auth discipline as app/routers/settings.py: every route
resolves the owner from the session cookie, never from a client-
supplied id, so there's no request shape that lets one owner register
or delete another's subscription.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import VAPID_PUBLIC_KEY
from app.db import get_pool
from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries
from app.queries import push_subscriptions as queries

router = APIRouter(prefix="/push", tags=["push"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
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
        row = await queries.upsert_subscription(
            conn, payload["owner_id"], body.endpoint, body.keys.p256dh, body.keys.auth, body.device_label
        )
        # update_preferences (not a raw UPDATE) — owner_preferences rows
        # are created lazily on first write, so a bare UPDATE would
        # silently affect zero rows for an owner who's never touched
        # any preference before now.
        await preferences_queries.update_preferences(conn, payload["owner_id"], {"push_enabled": True})
    return {"id": row["id"], "device_label": row["device_label"], "active": row["active"]}


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.post("/unsubscribe")
async def unsubscribe(body: UnsubscribeBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        found = await queries.deactivate_subscription(conn, payload["owner_id"], body.endpoint)
        if not found:
            raise HTTPException(status_code=404, detail="No matching subscription for this account")
        remaining = await queries.list_active_subscriptions_for_owner(conn, payload["owner_id"])
        if not remaining:
            # Only flip the master toggle off once literally every
            # device is gone — disabling on one device must never
            # disable notifications on the others still subscribed.
            await preferences_queries.update_preferences(conn, payload["owner_id"], {"push_enabled": False})
    return {"ok": True}


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
        subs = await queries.list_active_subscriptions_for_owner(conn, payload["owner_id"])
        if not subs:
            raise HTTPException(status_code=400, detail="No active push subscriptions on this account")
        delivered = await dispatcher.send_to_owner(conn, payload["owner_id"], formatter.test_notification())
    return {"delivered": delivered, "attempted": len(subs)}
