"""In-memory rate limit for POST /admin/track — same fixed-window
shape and same "in-process, per-instance, accepted trade-off at this
scale" reasoning as app/auth/rate_limit.py, just keyed by owner_id
instead of email/IP (a signed-in, identified caller, not an anonymous
one). Generous on purpose: real navigation never comes close to it,
this exists to stop a buggy or malicious client from flooding the
table, not to throttle normal use."""
import time
from collections import defaultdict

_WINDOW_SECONDS = 60
_MAX_EVENTS = 60

_events: dict[int, list[float]] = defaultdict(list)


def is_rate_limited(owner_id: int) -> bool:
    now = time.monotonic()
    window_start = now - _WINDOW_SECONDS
    recent = [t for t in _events[owner_id] if t > window_start]
    if len(recent) >= _MAX_EVENTS:
        _events[owner_id] = recent
        return True
    recent.append(now)
    _events[owner_id] = recent
    return False


def reset_for_tests() -> None:
    _events.clear()
