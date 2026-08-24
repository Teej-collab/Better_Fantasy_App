"""
Turns a notification type + data into the actual title/body/url a
device shows — the one place that owns Weekend League's notification
copy, so it never gets hand-written inline at each call site. Every
formatter returns the same shape the frontend's service worker expects
(see frontend/public/sw.js's push handler): {title, body, icon, badge,
url, data}. `url` is what a tap navigates to — every formatter sets a
real destination, never a bare "/" (per the explicit "don't just send
everything to the homepage" requirement).

Chat formatters exist alongside "test" today — Gamecast/fantasy event
formatters (TOUCHDOWN, MATCHUP_LEAD_CHANGE, etc.) land once the event
pipeline that would actually call them is wired up (app/gamecast's
normalized events feed app/notifications/events.py, not built yet —
this module is deliberately ready for that, not preemptively guessing
its exact payload shape).
"""

_DEFAULT_ICON = "/images/icon-192.png"
_BODY_PREVIEW_LENGTH = 120


def test_notification() -> dict:
    return {
        "title": "🔔 Test Notification",
        "body": "Weekend League notifications are working.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/settings?section=notifications",
        "data": {"type": "test"},
    }


def _preview(body: str) -> str:
    body = body.strip()
    if len(body) <= _BODY_PREVIEW_LENGTH:
        return body
    return body[:_BODY_PREVIEW_LENGTH].rstrip() + "…"


def chat_direct_message(sender_name: str, body: str) -> dict:
    return {
        "title": sender_name,
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/chat",
        "data": {"type": "chat_direct_message"},
    }


def chat_league_message(sender_name: str, body: str) -> dict:
    return {
        "title": f"{sender_name} in League Chat",
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/chat",
        "data": {"type": "chat_league_message"},
    }


def chat_mention(sender_name: str, body: str) -> dict:
    return {
        "title": f"{sender_name} mentioned you",
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/chat",
        "data": {"type": "chat_mention"},
    }


def chat_reply(sender_name: str, body: str) -> dict:
    return {
        "title": f"{sender_name} replied to you",
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/chat",
        "data": {"type": "chat_reply"},
    }
