"""
Thin wrapper around FCM's HTTP v1 API for sending to a single Android
device token — the native counterpart to pywebpush in
app/notifications/dispatcher.py. Calls FCM directly over httpx (already
a dependency) rather than pulling in firebase-admin, which is
synchronous-first and pulls a heavy grpcio/protobuf dependency chain
for what's fundamentally one authenticated POST per push — see
docs/NATIVE_MIGRATION_DEPENDENCIES.md for the fuller comparison.

FCM v1 requires a short-lived OAuth2 access token minted from the
service account's own RS256-signed JWT (the standard Google
"JWT bearer" grant) — this module mints and caches that token, only
refreshing once it's actually close to expiring, since minting one is
an extra round trip most sends shouldn't pay for.
"""
import json
import logging
import time

import httpx
import jwt

from app.config import require_fcm_configured

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# FCM's error.status for a token that will never succeed again — see
# https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode.
# Anything else (UNAVAILABLE, INTERNAL, a network error) is worth
# retrying on the next event.
_PERMANENT_FAILURE_STATUSES = {"UNREGISTERED", "INVALID_ARGUMENT"}

# Refresh a bit before Google's own ~1hr expiry, not exactly at it —
# avoids a request racing against a token that expires mid-flight.
_TOKEN_REFRESH_MARGIN_SECONDS = 300

_cached_access_token: str | None = None
_cached_access_token_expires_at: float = 0.0


def _reset_token_cache_for_tests() -> None:
    global _cached_access_token, _cached_access_token_expires_at
    _cached_access_token = None
    _cached_access_token_expires_at = 0.0


def _mint_assertion_jwt(service_account: dict) -> str:
    now = int(time.time())
    payload = {
        "iss": service_account["client_email"],
        "scope": FCM_SCOPE,
        "aud": service_account.get("token_uri", GOOGLE_TOKEN_URL),
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, service_account["private_key"], algorithm="RS256")


async def _get_access_token(service_account: dict) -> str:
    global _cached_access_token, _cached_access_token_expires_at
    if _cached_access_token and time.time() < _cached_access_token_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS:
        return _cached_access_token

    assertion = _mint_assertion_jwt(service_account)
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
        response.raise_for_status()
        body = response.json()

    _cached_access_token = body["access_token"]
    _cached_access_token_expires_at = time.time() + body.get("expires_in", 3600)
    return _cached_access_token


def _fcm_data_payload(data: dict) -> dict[str, str]:
    """FCM's "data" message field requires every value to be a string —
    unlike APNs' custom payload keys, which accept any JSON-serializable
    value. Non-string values (e.g. formatter.py's occasional int ids)
    are stringified, not dropped."""
    return {k: v if isinstance(v, str) else json.dumps(v) for k, v in data.items()}


async def send_fcm(push_token: str, payload: dict) -> tuple[bool, bool]:
    """Returns (delivered, permanently_gone). payload is the shared
    {title, body, icon, badge, url, data} shape from
    app/notifications/formatter.py — icon/badge have no FCM notification-payload
    analog worth sending (Android renders the app icon itself) and are
    dropped; url rides alongside the rest of "data", the same way
    frontend/public/sw.js's push handler already expects it."""
    service_account_json = require_fcm_configured()
    service_account = json.loads(service_account_json)
    access_token = await _get_access_token(service_account)

    data = dict(payload.get("data", {}))
    if payload.get("url"):
        data["url"] = payload["url"]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://fcm.googleapis.com/v1/projects/{service_account['project_id']}/messages:send",
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "message": {
                    "token": push_token,
                    "notification": {"title": payload.get("title", ""), "body": payload.get("body", "")},
                    "data": _fcm_data_payload(data),
                }
            },
        )

    if response.status_code == 200:
        return True, False

    error_status = None
    try:
        error_status = response.json().get("error", {}).get("status")
    except ValueError:
        pass
    logger.warning("FCM delivery failed (status_code=%s, error_status=%s)", response.status_code, error_status)
    return False, error_status in _PERMANENT_FAILURE_STATUSES
