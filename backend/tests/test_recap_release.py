"""The weekly recap going live at the Tuesday flip with a "LIVE NOW"
push (app/domain/recap_release.py), its admin read tracking, and the
admin alert for new feedback. These use stand-ins for the database and
push delivery: the suite runs against the production database, and
nothing here should write recap_releases rows or reach a real phone."""
import datetime
from types import SimpleNamespace

from httpx import ASGITransport, AsyncClient

from app.analytics import taxonomy
from app.auth.league_context import require_league_access
from app.domain import narrative_engine, recap_release
from app.main import app
from app.notifications import admin_alerts, dispatcher, formatter, quiet_hours
from app.queries import owner_preferences as preferences_queries
from app.routers import awards


# ---- when a recap counts as released ----------------------------------


def test_a_week_is_released_once_the_league_has_flipped_past_it():
    assert recap_release.is_released_week(3, 4) is True
    assert recap_release.is_released_week(4, 4) is False  # final, but not flipped yet
    assert recap_release.is_released_week(5, 4) is False


def test_a_season_with_nothing_synced_has_no_flip_to_wait_for():
    assert recap_release.is_released_week(1, None) is True


# ---- the LIVE NOW push ---------------------------------------------------


def test_recap_push_says_live_now_and_opens_the_recap_page():
    p = formatter.weekly_recap_live(2026, 3, "## The Week That Was\n\nKyren of the Lamb ate everyone's lunch.")
    assert p["title"] == "📰 Week 3 Recap — LIVE NOW"
    assert p["body"] == "The Week That Was"
    assert p["url"] == "/seasons/2026/weeks/3/recap?from=push"
    assert p["data"]["type"] == "weekly_recap"


def test_recap_and_feedback_pushes_wait_out_quiet_hours_instead_of_dropping():
    prefs = {
        "quiet_hours_enabled": True,
        "quiet_hours_start": datetime.time(22, 0),
        "quiet_hours_end": datetime.time(8, 0),
        "timezone": "America/Chicago",
    }
    late = datetime.datetime(2026, 10, 6, 23, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=-5)))
    for payload in (formatter.weekly_recap_live(2026, 4, "x"), formatter.admin_feedback_alert("TJ", "hi", False)):
        action, _ = quiet_hours.decide(prefs, payload, late)
        assert action == quiet_hours.DEFER


class _FakeConn:
    """Just enough of an asyncpg connection for release_and_notify."""

    def __init__(self, already_released: bool, owner_ids: list[int]):
        self.already_released = already_released
        self.owner_ids = owner_ids
        self.updated_count = None

    async def fetchval(self, sql, *args):
        return None if self.already_released else args[2]

    async def fetch(self, sql, *args):
        return [{"owner_id": o} for o in self.owner_ids]

    async def execute(self, sql, *args):
        self.updated_count = args[3]


def _stub_release(monkeypatch, *, kind="recap", prefs_by_owner=None):
    async def narrative(conn, season, week, league_id):
        return {"text": "Big week.", "kind": kind}

    async def prefs(conn, owner_id):
        return (prefs_by_owner or {}).get(owner_id, {"push_enabled": True, "notify_league": True})

    sent = []

    async def send(conn, owner_id, payload):
        sent.append((owner_id, payload["title"]))
        return 1

    monkeypatch.setattr(narrative_engine, "get_cached_weekly_narrative", narrative)
    monkeypatch.setattr(preferences_queries, "get_preferences", prefs)
    monkeypatch.setattr(dispatcher, "send_to_owner", send)
    return sent


async def test_release_pushes_members_who_want_league_notifications(monkeypatch):
    sent = _stub_release(monkeypatch, prefs_by_owner={2: {"push_enabled": True, "notify_league": False}})
    conn = _FakeConn(already_released=False, owner_ids=[1, 2, 3])
    notified = await recap_release.release_and_notify(conn, 2026, 3, 1)
    assert notified == 2
    assert [o for o, _ in sent] == [1, 3]
    assert conn.updated_count == 2


async def test_release_never_pushes_twice(monkeypatch):
    sent = _stub_release(monkeypatch)
    conn = _FakeConn(already_released=True, owner_ids=[1, 2])
    assert await recap_release.release_and_notify(conn, 2026, 3, 1) is None
    assert sent == []


async def test_an_old_week_is_released_quietly(monkeypatch):
    sent = _stub_release(monkeypatch)
    conn = _FakeConn(already_released=False, owner_ids=[1, 2])
    assert await recap_release.release_and_notify(conn, 2026, 1, 1, notify=False) == 0
    assert sent == []


async def test_nothing_to_release_without_a_recap(monkeypatch):
    sent = _stub_release(monkeypatch, kind="preview")
    conn = _FakeConn(already_released=False, owner_ids=[1])
    assert await recap_release.release_and_notify(conn, 2026, 3, 1) is None
    assert sent == []


# ---- the recap endpoint hides an unreleased recap from members -----------


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _get_recap(monkeypatch, *, released: bool, commissioner: bool):
    async def narrative(conn, season, week, league_id):
        return {"text": "Big week.", "kind": "recap"}

    async def is_released(conn, season, week):
        return released

    async def is_commissioner(conn, request, league_id):
        return commissioner

    monkeypatch.setattr(narrative_engine, "get_cached_weekly_narrative", narrative)
    monkeypatch.setattr(recap_release, "is_recap_released", is_released)
    monkeypatch.setattr(awards, "_is_commissioner", is_commissioner)
    app.dependency_overrides[require_league_access] = lambda: 1
    try:
        async with _client() as client:
            return (await client.get("/seasons/2026/weeks/4/recap")).json()["narrative"]
    finally:
        app.dependency_overrides.pop(require_league_access, None)


async def test_members_dont_see_the_recap_before_the_flip(monkeypatch):
    assert await _get_recap(monkeypatch, released=False, commissioner=False) is None


async def test_commissioners_see_it_early_marked_unreleased(monkeypatch):
    narrative = await _get_recap(monkeypatch, released=False, commissioner=True)
    assert narrative == {"text": "Big week.", "kind": "recap", "released": False}


async def test_everyone_sees_it_after_the_flip(monkeypatch):
    narrative = await _get_recap(monkeypatch, released=True, commissioner=False)
    assert narrative["released"] is True


# ---- tracking reads ------------------------------------------------------


def test_recap_opened_is_a_tracked_feature_event():
    assert taxonomy.validate_event("recap_opened", "feature", {"season": 2026, "week": 3, "source": "push"}, "mobile", "ios") is None
    assert taxonomy.validate_event("recap_opened", "feature", {"season": 2026, "email": "x"}, None, None) is not None


# ---- feedback alerts the admins ------------------------------------------


async def test_feedback_alerts_every_admin_but_the_one_who_sent_it(monkeypatch):
    async def admins(conn):
        return [10, 20]

    sent = {}

    async def send_to_owners(conn, owner_ids, payload):
        sent["owner_ids"] = owner_ids
        sent["payload"] = payload
        return len(owner_ids)

    monkeypatch.setattr(admin_alerts, "admin_owner_ids", admins)
    monkeypatch.setattr(dispatcher, "send_to_owners", send_to_owners)
    await admin_alerts.alert_feedback(SimpleNamespace(), "TJ", "The ticker is too small", False, submitter_owner_id=10)
    assert sent["owner_ids"] == [20]
    assert sent["payload"]["title"] == "💬 New feedback from TJ"
    assert sent["payload"]["body"] == "The ticker is too small"
    assert sent["payload"]["url"] == "/settings?section=feedback"
