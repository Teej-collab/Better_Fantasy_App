"""
Sign in with Apple, native only (2026-10). Apple requires it in any iOS
app that also offers Google or Discord sign-in.

The iOS app gets an identity token (a JWT signed by Apple) straight
from the system sheet — no redirect round trip like Google or Discord —
and posts it to /auth/apple/native. This module checks that token:
Apple's signature (keys from Apple's JWKS endpoint), issuer, expiry,
and that the audience is one of our own app's bundle IDs, so a token
minted for some other app can't sign in here.

APPLE_BUNDLE_IDS is a comma-separated list (the App Store app's bundle
ID, plus any other build that signs in, e.g. a dev build with its own
ID). Defaults to the native app's bundle ID so it works without setup.
"""
import logging
import os
import time

import httpx
import jwt
from jwt import PyJWKClient

from app.config import normalize_pem_key

logger = logging.getLogger(__name__)

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
DEFAULT_BUNDLE_IDS = "com.weekendleague.native"

# PyJWKClient caches Apple's keys between calls and refetches when it
# sees a key ID it doesn't know (Apple rotates them).
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True)
    return _jwks_client


def allowed_audiences() -> list[str]:
    raw = os.getenv("APPLE_BUNDLE_IDS") or DEFAULT_BUNDLE_IDS
    return [a.strip() for a in raw.split(",") if a.strip()]


class AppleTokenError(Exception):
    pass


def verify_identity_token(identity_token: str) -> dict:
    """Returns the token's claims ({"sub", "email", ...}) or raises
    AppleTokenError. Blocking (the JWKS fetch is a plain HTTP call), so
    callers run it in a thread."""
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(identity_token)
        claims = jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=allowed_audiences(),
            issuer=APPLE_ISSUER,
        )
    except jwt.PyJWTError as e:
        raise AppleTokenError(str(e)) from e
    if not claims.get("sub"):
        raise AppleTokenError("Token has no subject")
    return claims


# ---- Token revocation on account deletion (2026-10) -----------------------
#
# Apple asks apps with Sign in with Apple to revoke the user's token when
# they delete their account. That takes the refresh token from exchanging
# the sign-in's authorization code, and a client secret signed with a
# Sign in with Apple key (a .p8 from the developer portal with "Sign in
# with Apple" ticked): APPLE_SIGNIN_KEY_ID and APPLE_SIGNIN_KEY_CONTENT,
# plus the team ID (APPLE_TEAM_ID, falling back to APNS_TEAM_ID). Without
# them sign-in works exactly as before and deletion skips the revoke.

APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"


def _signin_key() -> tuple[str, str, str] | None:
    key_id = os.getenv("APPLE_SIGNIN_KEY_ID")
    team_id = os.getenv("APPLE_TEAM_ID") or os.getenv("APNS_TEAM_ID")
    key = normalize_pem_key(os.getenv("APPLE_SIGNIN_KEY_CONTENT"))
    if not (key_id and team_id and key):
        return None
    return key_id, team_id, key


def revocation_configured() -> bool:
    return _signin_key() is not None


def _client_id() -> str:
    return allowed_audiences()[0]


def _client_secret() -> str:
    key_id, team_id, key = _signin_key()  # type: ignore[misc]
    now = int(time.time())
    return jwt.encode(
        {"iss": team_id, "iat": now, "exp": now + 300, "aud": APPLE_ISSUER, "sub": _client_id()},
        key,
        algorithm="ES256",
        headers={"kid": key_id},
    )


async def exchange_code_for_refresh_token(authorization_code: str) -> str | None:
    """The refresh token for a fresh sign-in's authorization code, or None
    (not configured, or Apple said no — never blocks the sign-in)."""
    if not revocation_configured() or not authorization_code:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                APPLE_TOKEN_URL,
                data={
                    "client_id": _client_id(),
                    "client_secret": _client_secret(),
                    "code": authorization_code,
                    "grant_type": "authorization_code",
                },
            )
        if response.status_code != 200:
            logger.warning("Apple token exchange failed (status=%s, body=%s)", response.status_code, response.text[:200])
            return None
        return response.json().get("refresh_token")
    except Exception:
        logger.warning("Apple token exchange failed", exc_info=True)
        return None


async def revoke_refresh_token(refresh_token: str) -> bool:
    if not revocation_configured() or not refresh_token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                APPLE_REVOKE_URL,
                data={
                    "client_id": _client_id(),
                    "client_secret": _client_secret(),
                    "token": refresh_token,
                    "token_type_hint": "refresh_token",
                },
            )
        if response.status_code != 200:
            logger.warning("Apple token revoke failed (status=%s)", response.status_code)
            return False
        return True
    except Exception:
        logger.warning("Apple token revoke failed", exc_info=True)
        return False
