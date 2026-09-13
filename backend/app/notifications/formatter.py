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


def _chat_url(conversation_id: int) -> str:
    # 2026-09 fix, real report: every chat push used to land on bare
    # /chat regardless of which conversation the message was actually
    # in — ChatApp.tsx always defaults to the first/most-recent
    # conversation, so tapping a notification for an OLDER thread (or
    # any thread that isn't already the most recent) silently opened
    # the wrong one. frontend/src/app/(chat)/chat/page.tsx now reads
    # this query param and pre-selects the matching conversation.
    return f"/chat?conversation={conversation_id}"


def chat_direct_message(sender_name: str, body: str, conversation_id: int) -> dict:
    return {
        "title": sender_name,
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": _chat_url(conversation_id),
        "data": {"type": "chat_direct_message"},
    }


def chat_league_message(sender_name: str, body: str, conversation_id: int) -> dict:
    return {
        "title": f"{sender_name} in League Chat",
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": _chat_url(conversation_id),
        "data": {"type": "chat_league_message"},
    }


def chat_mention(sender_name: str, body: str, conversation_id: int) -> dict:
    return {
        "title": f"{sender_name} mentioned you",
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": _chat_url(conversation_id),
        "data": {"type": "chat_mention"},
    }


def chat_reply(sender_name: str, body: str, conversation_id: int) -> dict:
    return {
        "title": f"{sender_name} replied to you",
        "body": _preview(body) or "Sent an image",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": _chat_url(conversation_id),
        "data": {"type": "chat_reply"},
    }


def draft_starting_soon(minutes: int) -> dict:
    return {
        "title": "🏈 Draft starting soon",
        "body": f"The draft starts in {minutes} minutes — get in the room.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/draft",
        "data": {"type": "draft_starting_soon"},
    }


def draft_room_open() -> dict:
    return {
        "title": "🏈 Draft room is open",
        "body": "Build your player queue now — the real draft starts in an hour.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/draft",
        "data": {"type": "draft_room_open"},
    }


def draft_live() -> dict:
    return {
        "title": "🏈 The draft is live",
        "body": "Picking has started — get in the room.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/draft",
        "data": {"type": "draft_live"},
    }


def keeper_deadline_approaching(minutes: int) -> dict:
    return {
        "title": "⏰ Keeper picks lock soon",
        "body": f"Keeper selections lock in {minutes} minutes — make your pick now if you haven't.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/keepers",
        "data": {"type": "keeper_deadline_approaching"},
    }


def draft_on_the_clock(round_num: int, pick_number: int, seconds: int) -> dict:
    return {
        "title": "🏈 You're on the clock",
        "body": f"Round {round_num}, pick {pick_number} — you have {seconds} seconds to pick.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/draft",
        "data": {"type": "draft_on_the_clock"},
    }


def fantasy_player_touchdown(player_name: str, team_name: str) -> dict:
    return {
        "title": "🔥 Touchdown!",
        "body": f"{player_name} just scored for your {team_name}.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/team",
        "data": {"type": "fantasy_player_touchdown"},
    }


def fantasy_matchup_lead_change(now_leading: bool, opponent_name: str) -> dict:
    if now_leading:
        return {
            "title": "📈 You just took the lead",
            "body": f"You're now ahead of {opponent_name}.",
            "icon": _DEFAULT_ICON,
            "badge": _DEFAULT_ICON,
            "url": "/team",
            "data": {"type": "fantasy_matchup_lead_change"},
        }
    return {
        "title": "📉 You just lost the lead",
        "body": f"{opponent_name} just took the lead over you.",
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": "/team",
        "data": {"type": "fantasy_matchup_lead_change"},
    }
