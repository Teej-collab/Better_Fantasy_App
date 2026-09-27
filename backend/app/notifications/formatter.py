"""
Turns a notification type + data into the actual title/body/url a
device shows — the one place that owns Weekend League's notification
copy, so it never gets hand-written inline at each call site. Every
formatter returns the same shape the frontend's service worker expects
(see frontend/public/sw.js's push handler): {title, body, icon, badge,
url, data}. `url` is what a tap navigates to — every formatter sets a
real destination, never a bare "/" (per the explicit "don't just send
everything to the homepage" requirement).

Fantasy-activity formatters (touchdowns, red zone, lead changes) are
called from app/notifications/fantasy_events.py.
"""

_DEFAULT_ICON = "/images/icon-192.png"
_BODY_PREVIEW_LENGTH = 120


def _payload(title: str, body: str, url: str, type_: str, tag: str | None = None) -> dict:
    """Every notification goes through here so the shape never drifts.
    `url` is repeated inside `data` because that's where the service
    worker's notificationclick handler (frontend/public/sw.js) and the
    native app's tap handler (NativePushRegistration.tsx) read it from —
    a top-level url alone used to be dropped on the web, so every tap
    opened the homepage. `tag` lets a newer notification replace an
    older one about the same thing (a lead flipping back and forth, a
    team re-entering the red zone) instead of stacking up."""
    data = {"type": type_, "url": url}
    if tag:
        data["tag"] = tag
    return {
        "title": title,
        "body": body,
        "icon": _DEFAULT_ICON,
        "badge": _DEFAULT_ICON,
        "url": url,
        "tag": tag,
        "data": data,
    }


def test_notification() -> dict:
    return _payload(
        "🔔 Test Notification", "Weekend League notifications are working.",
        "/settings?section=notifications", "test",
    )


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
    return _payload(sender_name, _preview(body) or "Sent an image", _chat_url(conversation_id), "chat_direct_message")


def chat_league_message(sender_name: str, body: str, conversation_id: int) -> dict:
    return _payload(f"{sender_name} in League Chat", _preview(body) or "Sent an image", _chat_url(conversation_id), "chat_league_message")


def chat_mention(sender_name: str, body: str, conversation_id: int) -> dict:
    return _payload(f"{sender_name} mentioned you", _preview(body) or "Sent an image", _chat_url(conversation_id), "chat_mention")


def chat_reply(sender_name: str, body: str, conversation_id: int) -> dict:
    return _payload(f"{sender_name} replied to you", _preview(body) or "Sent an image", _chat_url(conversation_id), "chat_reply")


def draft_starting_soon(minutes: int) -> dict:
    return _payload("🏈 Draft starting soon", f"The draft starts in {minutes} minutes — get in the room.", "/draft", "draft_starting_soon")


def draft_room_open() -> dict:
    return _payload("🏈 Draft room is open", "Build your player queue now — the real draft starts in an hour.", "/draft", "draft_room_open")


def draft_live() -> dict:
    return _payload("🏈 The draft is live", "Picking has started — get in the room.", "/draft", "draft_live")


def keeper_deadline_approaching(minutes: int) -> dict:
    return _payload("⏰ Keeper picks lock soon", f"Keeper selections lock in {minutes} minutes — make your pick now if you haven't.", "/keepers", "keeper_deadline_approaching")


def draft_on_the_clock(round_num: int, pick_number: int, seconds: int) -> dict:
    return _payload("🏈 You're on the clock", f"Round {round_num}, pick {pick_number} — you have {seconds} seconds to pick.", "/draft", "draft_on_the_clock")


def chug_posted(owner_name: str, final_score: float, has_video: bool) -> dict:
    """League-wide (notify_league — see app/queries/owner_preferences.py),
    sent to every other owner in the league once a real graded chug is
    recorded (app/routers/chug.py's upload endpoint). has_video controls
    whether the body invites people to go watch it (Recent Chugs, the
    homepage/`/chug` feed) or just reports the grade — a chug graded
    before video storage existed, or one whose upload failed, has
    nothing to watch."""
    body = f"{owner_name} just posted a {final_score:g}/10 chug"
    body += " — go watch it." if has_video else "."
    return _payload("🍺 New Chug Posted", body, "/chug", "chug_posted")


_TD_KIND_LABEL = {"rush_td": "Rushing TD", "rec_td": "Receiving TD", "pass_td": "Passing TD"}


def _matchup_url(matchup_id: int | None) -> str:
    # Straight to the owner's own matchup for the week — where a
    # touchdown or a lead change actually matters — falling back to My
    # Team only when there's no matchup (bye week, schedule not set).
    return f"/matchups/{matchup_id}" if matchup_id else "/team"


def _points(delta: float | None) -> str:
    return f" (+{delta:.1f} pts)" if delta and delta > 0 else ""


def fantasy_player_touchdown(
    player_name: str, team_name: str, td_kind: str | None, points_delta: float | None,
    matchup_id: int | None, on_bench: bool, tag: str,
) -> dict:
    kind = _TD_KIND_LABEL.get(td_kind or "", "Touchdown")
    if on_bench:
        return _payload(
            f"💀 {player_name} scored on your bench",
            f"{kind}{_points(points_delta)} — none of it counts for {team_name}.",
            _matchup_url(matchup_id), "fantasy_player_touchdown", tag,
        )
    return _payload(
        f"🏈 TOUCHDOWN · {player_name}",
        f"{kind}{_points(points_delta)} for {team_name}.",
        _matchup_url(matchup_id), "fantasy_player_touchdown", tag,
    )


def fantasy_red_zone(pro_team: str, player_names: list[str], matchup_id: int | None) -> dict:
    if len(player_names) == 1:
        who = f"{player_names[0]} is"
    elif len(player_names) == 2:
        who = f"{player_names[0]} and {player_names[1]} are"
    else:
        who = f"{', '.join(player_names[:-1])}, and {player_names[-1]} are"
    return _payload(
        f"🚨 Red Zone · {pro_team}",
        f"{who} inside the 20. Touchdown watch.",
        _matchup_url(matchup_id), "fantasy_red_zone", f"red-zone-{pro_team}",
    )


def fantasy_matchup_lead_change(
    now_leading: bool, opponent_name: str, my_score: float, their_score: float, matchup_id: int,
) -> dict:
    score = f"{my_score:.1f}–{their_score:.1f}"
    if now_leading:
        return _payload(
            "📈 You took the lead",
            f"Up {score} on {opponent_name}.",
            _matchup_url(matchup_id), "fantasy_matchup_lead_change", f"lead-{matchup_id}",
        )
    return _payload(
        "📉 You lost the lead",
        f"{opponent_name} leads you {their_score:.1f}–{my_score:.1f}.",
        _matchup_url(matchup_id), "fantasy_matchup_lead_change", f"lead-{matchup_id}",
    )
