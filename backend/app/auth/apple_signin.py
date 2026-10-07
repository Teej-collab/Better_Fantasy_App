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
import os

import jwt
from jwt import PyJWKClient

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
