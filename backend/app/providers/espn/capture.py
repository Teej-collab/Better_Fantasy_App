"""
Phase 3 diagnostic utility: lets us compare a real lineup-change request
captured from ESPN Fantasy's own web app (via Chrome DevTools) against
whatever we're assuming the write request looks like — without ever
needing real credentials to live in this repo, in chat, or in a log.

See ESPN_LINEUP_WRITE.md for exactly what to capture and how to
redact it. This module redacts again anyway, on the assumption a human
copy-paste is not a trustworthy place to stop.
"""
from dataclasses import dataclass, field

# Header names that carry a live session credential and must never be
# stored or displayed. Matched case-insensitively, and "cookie"/
# "authoriz" match as substrings since ESPN or a proxy could plausibly
# send these under a slightly different exact header name.
_SENSITIVE_HEADER_SUBSTRINGS = ("cookie", "authoriz", "x-fantasy-authz", "x-fantasy-filter")
_SENSITIVE_COOKIE_KEYS = {"espn_s2", "swid"}
REDACTED = "<REDACTED>"


@dataclass
class CapturedRequest:
    method: str
    url: str
    headers: dict = field(default_factory=dict)
    cookies: dict = field(default_factory=dict)
    body: dict | str | None = None
    response_status: int | None = None
    response_body: dict | str | None = None


def redact_captured_request(raw: dict) -> dict:
    """Strips anything that could be a live session credential from a
    raw captured-request dict. Call this BEFORE the data is written to a
    file in this repo, logged, or pasted into chat — never assume a
    human has already done it."""
    redacted = dict(raw)

    headers = dict(redacted.get("headers") or {})
    for key in list(headers):
        if any(s in key.lower() for s in _SENSITIVE_HEADER_SUBSTRINGS):
            headers[key] = REDACTED
    redacted["headers"] = headers

    cookies = dict(redacted.get("cookies") or {})
    for key in list(cookies):
        if key.lower() in _SENSITIVE_COOKIE_KEYS:
            cookies[key] = REDACTED
    redacted["cookies"] = cookies

    return redacted


def compare_shape(captured: dict, assumed_method: str, assumed_url: str) -> dict:
    """Best-effort structural comparison — does the captured request's
    method and URL host/path shape match what we assumed? Does NOT
    compare bodies; a body diff needs a human reading both side by side,
    since ESPN's write body structure is exactly the unverified part
    this whole investigation exists to pin down."""
    captured_method = (captured.get("method") or "").upper()
    captured_url = captured.get("url") or ""

    assumed_host = assumed_url.split("/")[2] if "://" in assumed_url else assumed_url
    return {
        "method_matches": captured_method == assumed_method.upper(),
        "host_matches": assumed_host in captured_url,
        "captured_method": captured_method,
        "captured_url": captured_url,
        "assumed_method": assumed_method.upper(),
        "assumed_url": assumed_url,
    }
