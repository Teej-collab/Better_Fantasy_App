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

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

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
