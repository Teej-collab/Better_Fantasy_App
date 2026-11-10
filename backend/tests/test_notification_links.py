"""
Every push opens a real page (2026-11-10): a tap on a notification goes
straight to what it's about, so each formatter's url has to be a page
the web actually has (frontend/src/app). The app maps the same paths in
mobile/src/lib/localNotifications.ts's toNativePath.

A new formatter has to be added to _SAMPLES, so its link gets checked.
"""
import datetime
import inspect
import re
from pathlib import Path

from app.notifications import formatter

_WEB_APP = Path(__file__).resolve().parents[2] / "frontend" / "src" / "app"

_SAMPLES = {
    "admin_chat_report_alert": lambda f: f("A", "B", "spam"),
    "admin_crash_alert": lambda f: f("TypeError", "/team", "ios", "Team", 2),
    "admin_error_alert": lambda f: f({"severity": "high", "headline": "h", "what": "w"}, "server", who=None, os=None, is_new=True, fingerprint="abc123"),
    "admin_feedback_alert": lambda f: f("A", "hi", False),
    "admin_health_alert": lambda f: f("db", "DB slow", "body", recovered=False),
    "admin_security_alert": lambda f: f("body"),
    "bet_shared": lambda f: f("A", 3),
    "chat_direct_message": lambda f: f("A", "hi", 5),
    "chat_group_message": lambda f: f("A", "hi", 5),
    "chat_league_message": lambda f: f("A", "hi", 5),
    "chat_mention": lambda f: f("A", "hi", 5),
    "chat_reply": lambda f: f("A", "hi", 5),
    "chug_cheered": lambda f: f("A", 7),
    "chug_deadline_soon": lambda f: f(1, "8:15 PM", datetime.datetime(2026, 11, 9, 20, 15, tzinfo=datetime.timezone.utc), "t"),
    "chug_posted": lambda f: f("A", 8.5, True, 7),
    "chug_settled": lambda f: f("paid", 2, 1, 0, "t"),
    "chugs_owed": lambda f: f(9, 1, ["A"], 1, "t"),
    "close_game": lambda f: f("Close", "body", 12),
    "commish_lineup_note": lambda f: f("Moved your RB"),
    "draft_live": lambda f: f(),
    "draft_on_the_clock": lambda f: f(1, 3, 90),
    "draft_room_open": lambda f: f(),
    "draft_starting_soon": lambda f: f(30),
    "fantasy_matchup_lead_change": lambda f: f(True, "Them", 80.0, 70.0, 12),
    "fantasy_player_touchdown": lambda f: f("P", "Team", "rush_td", 6.0, 12, False, "t"),
    "fantasy_red_zone": lambda f: f("KC", ["P"], 12, "401772936"),
    "friend_accepted": lambda f: f("A", 3),
    "friend_request": lambda f: f("A", 3),
    "guillotine_cut": lambda f: f("Team", 9, 61.2, 5),
    "held_player_updates": lambda f: f([{"title": "a"}, {"title": "b"}]),
    "inactive_starter": lambda f: f("P", "1:00 PM", "t"),
    "injury_in_game": lambda f: f("P", "left", 12, "t"),
    "injury_update": lambda f: f("P", "downgrade", "Out", "Questionable", "Knee", None, "t", "4034"),
    "join_request": lambda f: f("A", "League"),
    "keeper_deadline_approaching": lambda f: f(60),
    "keeper_nudge": lambda f: f("A"),
    "lounge_invite": lambda f: f("A", "Room", "abc-123"),
    "lounge_mention": lambda f: f("A", "hi", 4, "Room"),
    "matchup_final": lambda f: f("won", "Them", 100.0, 90.0, "6-3", 12),
    "player_news": lambda f: f("P", "Full practice.", "t", "4034"),
    "pregame_starter_out": lambda f: f("P", "Out", "1:00 PM", 12, "t"),
    "punishment_wheel_result": lambda f: f(2026, "Wear the jersey"),
    "survivor_pick_needed": lambda f: f("Pool", 10, 3, 2, 5),
    "test_notification": lambda f: f(),
    "trade_block_listed": lambda f: f("Team", ["P"], 4),
    "trade_offer": lambda f: f("Team", "P for Q", 8),
    "trade_update": lambda f: f("Accepted", "body", 8),
    "waiver_results": lambda f: f([], [{"player": "P", "reason": "Outbid"}]),
    "watch_party_invite": lambda f: f("A", "Room", 4),
    "watch_party_started": lambda f: f("A", "Room", 4, None),
    "weekly_recap_live": lambda f: f(2026, 9, "Recap"),
}
# Helpers that build a url, not a push; correction re-sends a url it's given.
_NOT_PUSHES = {"chug_url", "player_card_url", "recap_url", "correction"}


def _web_routes() -> list[re.Pattern]:
    """Each page or route handler under frontend/src/app as a regex,
    route groups like (app) dropped and [param] matching one segment."""
    routes = []
    for file in [*_WEB_APP.rglob("page.tsx"), *_WEB_APP.rglob("route.ts")]:
        parts = [p for p in file.parent.relative_to(_WEB_APP).parts if not (p.startswith("(") and p.endswith(")"))]
        pattern = "/".join(r"[^/]+" if p.startswith("[") else re.escape(p) for p in parts)
        routes.append(re.compile(f"^/{pattern}$" if pattern else "^/$"))
    # Plain redirects in next.config.ts (e.g. /admin/brain → /brain).
    config = (_WEB_APP.parents[1] / "next.config.ts").read_text()
    routes += [re.compile(f"^{re.escape(src)}$") for src in re.findall(r'source: "(/[^":*]*)", destination', config)]
    return routes


def test_every_formatter_has_a_sample():
    public = {
        name for name, fn in inspect.getmembers(formatter, inspect.isfunction)
        if fn.__module__ == formatter.__name__ and not name.startswith("_")
    }
    assert public - _NOT_PUSHES == set(_SAMPLES)


def test_every_push_opens_a_real_web_page():
    routes = _web_routes()
    assert routes, f"no pages found under {_WEB_APP}"
    for name, call in _SAMPLES.items():
        payload = call(getattr(formatter, name))
        url = payload["url"]
        assert payload["data"]["url"] == url, name
        path = url.split("?")[0]
        assert any(r.match(path) for r in routes), f"{name} opens {url}, which isn't a page"


def test_specific_pushes_open_the_specific_thing():
    assert formatter.trade_offer("Team", "P for Q", 8)["url"] == "/trades?trade=8"
    assert formatter.trade_update("Accepted", "body", 8)["url"] == "/trades?trade=8"
    assert formatter.chug_cheered("A", 7)["url"] == "/chug?chug=7"
    assert formatter.injury_update("P", "new", "Out", None, None, None, "t", "4034")["url"] == "/team?card=4034"
    assert formatter.player_news("P", "News.", "t", "4034")["url"] == "/team?card=4034"
    assert formatter.join_request("A", "League")["url"] == "/commissioner/members"
