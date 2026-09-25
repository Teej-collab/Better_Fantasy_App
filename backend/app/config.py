"""
Central config. Every secret comes from the environment.

Same fail-loudly discipline as Fantasy_Helper's bot/config.py: required
values raise at import time instead of surfacing as a confusing error deep
in a request handler.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return val


DATABASE_URL = _require("DATABASE_URL")

# Phase 4 of the multi-league migration (see TODO.md's PHASE 9 entry).
# Every fantasy-league query is being threaded to filter by league_id
# explicitly, the same way ACTIVE_SEASON already threads through as
# "the current season" — but there's no real multi-league selection
# yet (no session concept of "which league," no UI to create/join a
# second one), so there is exactly one meaningful value for it today:
# League #1, the real league, backfilled in migration d7deccb620bb.
# Not an env var like ACTIVE_SEASON (that changes every year; this
# doesn't change until real league selection exists) — a plain
# constant is honest about that. Phase 5/6 replaces every call site
# that reads this with a real resolved value (the signed-in user's
# actual league), at which point this constant goes away entirely.
DEFAULT_LEAGUE_ID = 1

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Chat's GIF picker (app/providers/giphy.py). Optional at import time,
# same as ANTHROPIC_API_KEY above — empty until the owner generates a
# free key and adds it here or on Railway; giphy.search() fails loud
# with a clear message if it's still unset when actually called.
GIPHY_API_KEY = os.getenv("GIPHY_API_KEY")

# Hostname of the Vercel Blob store chat image uploads land in (see
# frontend/src/app/api/chat/upload/route.ts). Chat messages only ever
# accept an image_url whose host matches this — never an arbitrary
# URL — so a compromised or buggy client can't get the WS handler to
# persist a link to something else. Defaults to the store already
# provisioned for this app; override via env if the store is ever
# recreated under a different id.
CHAT_IMAGE_HOST = os.getenv("CHAT_IMAGE_HOST", "ls7srleyqyy06rjq.public.blob.vercel-storage.com")

# Web Push (app/routers/push.py). Optional at import time — plenty of the
# app runs fine with push not configured yet (local dev without a
# generated keypair, or before it's provisioned in production) — but
# every route that actually sends a push calls require_vapid_configured()
# first and fails loudly there instead of silently no-op-ing, same
# "fail loud, not quiet" spirit as _require() above, just deferred to
# the moment it's actually needed rather than at import time.
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT")


def require_vapid_configured() -> tuple[str, str, str]:
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_SUBJECT):
        raise RuntimeError(
            "Web Push isn't configured — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, "
            "and VAPID_SUBJECT (see .env.example)."
        )
    return VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT


# Outbound email (app/notifications/email.py) — the app's first ever
# email-sending capability, only for the password-reset flow so far.
# Same optional-at-import, fail-loud-at-use pattern as VAPID above:
# local dev and CI never need a real Resend account, only whichever
# environment actually calls POST /auth/forgot-password for real.
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL")


def require_email_configured() -> tuple[str, str]:
    if not (RESEND_API_KEY and RESEND_FROM_EMAIL):
        raise RuntimeError(
            "Email sending isn't configured — set RESEND_API_KEY and RESEND_FROM_EMAIL (see .env.example)."
        )
    return RESEND_API_KEY, RESEND_FROM_EMAIL


# Watch Party (app/routers/watch_party.py) — LiveKit Cloud is a
# separate account the commissioner sets up themselves (not something
# this app can provision), so this follows the same optional-at-import,
# fail-loud-at-use pattern as email/push above rather than crashing
# every environment that hasn't set it up yet. Tokens are minted by
# hand with PyJWT (already a dependency, used for session/ticket tokens
# elsewhere in this app) rather than pulling in LiveKit's own server
# SDK — a LiveKit access token is just an HS256 JWT with a documented
# claim shape, confirmed against LiveKit's own python-sdks source
# (livekit-api/livekit/api/access_token.py) rather than assumed.
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
LIVEKIT_URL = os.getenv("LIVEKIT_URL")


def require_livekit_configured() -> tuple[str, str, str]:
    if not (LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_URL):
        raise RuntimeError(
            "Watch Party video isn't configured — set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, "
            "and LIVEKIT_URL (see .env.example)."
        )
    return LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL


# Native push — APNs (app/notifications/apns_client.py), additive to Web
# Push above. Same optional-at-import, fail-loud-at-use pattern: no
# native client exists yet, so nothing should ever call
# require_apns_configured() in production until one does.
# APNS_KEY_CONTENT is the .p8 provider-auth key's own PEM content
# (not a file path) — passed straight through to aioapns, which hands
# it to PyJWT for ES256 signing.
APNS_KEY_ID = os.getenv("APNS_KEY_ID")
APNS_TEAM_ID = os.getenv("APNS_TEAM_ID")
APNS_BUNDLE_ID = os.getenv("APNS_BUNDLE_ID")
APNS_KEY_CONTENT = os.getenv("APNS_KEY_CONTENT")


def require_apns_configured() -> tuple[str, str, str, str]:
    if not (APNS_KEY_ID and APNS_TEAM_ID and APNS_BUNDLE_ID and APNS_KEY_CONTENT):
        raise RuntimeError(
            "Native iOS push isn't configured — set APNS_KEY_ID, APNS_TEAM_ID, "
            "APNS_BUNDLE_ID, and APNS_KEY_CONTENT (see .env.example)."
        )
    return APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_KEY_CONTENT


# Native push — FCM (app/notifications/fcm_client.py), same pattern.
# FCM_SERVICE_ACCOUNT_JSON is the whole Google service-account JSON key
# file's content (not a path) — kept as one JSON blob, matching how
# Google itself distributes this credential, rather than splitting it
# into several env vars.
FCM_SERVICE_ACCOUNT_JSON = os.getenv("FCM_SERVICE_ACCOUNT_JSON")


def require_fcm_configured() -> str:
    if not FCM_SERVICE_ACCOUNT_JSON:
        raise RuntimeError(
            "Native Android push isn't configured — set FCM_SERVICE_ACCOUNT_JSON (see .env.example)."
        )
    return FCM_SERVICE_ACCOUNT_JSON
