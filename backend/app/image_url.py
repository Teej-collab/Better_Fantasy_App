"""Shared host-allowlist validation for any URL a client claims points
at an uploaded image — used wherever a client-supplied Blob URL gets
persisted (chat image attachments, a logo upload), never trusting the
URL itself beyond "does it actually point at our own Blob store or a
known, trusted external CDN we explicitly send clients to."

One Blob store for the whole app (not per-feature buckets — see
CHAT_IMAGE_HOST's own history as the first, and until now only, use of
it), so a single shared check is correct rather than one copy per
feature that could quietly drift apart. Tenor's own CDN is the one
deliberate exception (2026-09, the chat GIF picker) — its GIF URLs
come straight from Tenor's search response (app/providers/tenor.py),
never uploaded through our own Blob store, but they're still only ever
reached via our server-side proxy, never a client-typed URL, so this
is exactly as trustworthy as the Blob store host."""
from urllib.parse import urlparse

from app.config import CHAT_IMAGE_HOST

# Tenor serves GIF media from several numbered/regional subdomains
# (media.tenor.com, media1.tenor.com, ...) — a suffix check, not one
# more exact hostname to keep in sync with whichever one a given
# search result happens to use.
TENOR_MEDIA_HOST_SUFFIX = ".tenor.com"


def validate_blob_image_url(value) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    if parsed.hostname == CHAT_IMAGE_HOST:
        return value
    if parsed.hostname.endswith(TENOR_MEDIA_HOST_SUFFIX):
        return value
    return None
