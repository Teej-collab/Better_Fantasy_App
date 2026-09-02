"""Shared host-allowlist validation for any URL a client claims points
at an uploaded image — used wherever a client-supplied Blob URL gets
persisted (chat image attachments, a logo upload), never trusting the
URL itself beyond "does it actually point at our own Blob store."

One Blob store for the whole app (not per-feature buckets — see
CHAT_IMAGE_HOST's own history as the first, and until now only, use of
it), so a single shared check is correct rather than one copy per
feature that could quietly drift apart."""
from urllib.parse import urlparse

from app.config import CHAT_IMAGE_HOST


def validate_blob_image_url(value) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != CHAT_IMAGE_HOST:
        return None
    return value
