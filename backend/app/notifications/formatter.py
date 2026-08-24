"""
Turns a notification type + data into the actual title/body/url a
device shows — the one place that owns Weekend League's notification
copy, so it never gets hand-written inline at each call site. Every
formatter returns the same shape the frontend's service worker expects
(see frontend/public/sw.js's push handler): {title, body, icon, badge,
url, data}. `url` is what a tap navigates to — every formatter sets a
real destination, never a bare "/" (per the explicit "don't just send
everything to the homepage" requirement).

Only a "test" formatter exists today — Gamecast/fantasy event
formatters (TOUCHDOWN, MATCHUP_LEAD_CHANGE, etc.) land once the event
pipeline that would actually call them is wired up (app/gamecast's
normalized events feed app/notifications/events.py, not built yet —
this module is deliberately ready for that, not preemptively guessing
its exact payload shape).
"""

_DEFAULT_ICON = "/images/icon-192.png"


def test_notification() -> dict:
    return {
        "title": "🔔 Test Notification",
        "body": "Weekend League notifications are working.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/settings?section=notifications",
        "data": {"type": "test"},
    }
