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
