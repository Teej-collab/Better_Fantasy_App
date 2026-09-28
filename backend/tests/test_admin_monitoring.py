"""Admin dashboard monitoring: error/security/audit capture
(app/monitoring.py), admin push alerts (app/notifications/
admin_alerts.py), and the Engagement/Live/Paths/Errors/Security/Audit
endpoints. Every row a test writes is tagged with a unique marker and
deleted by that test — this suite runs against the production database
(see tests/conftest.py)."""
import datetime
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app import monitoring
from app.auth.session import create_session_token
from app.main import app
from app.notifications import admin_alerts, quiet_hours

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"

ADMIN_READ_PATHS = [
    "/admin/engagement",
    "/admin/live",
    "/admin/paths",
    "/admin/errors",
    "/admin/security",
    "/admin/audit",
    "/admin/badges",
    "/admin/crashes",
]


def _cookie(user_id: int) -> dict:
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id, owner_id=1)}


async def _user(pool, *, admin: bool) -> int:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Test Monitor') RETURNING id",
            f"test-monitoring-{uuid.uuid4().hex[:12]}@example.com",
        )
        if admin:
            await conn.execute("UPDATE users SET is_admin = TRUE WHERE id = $1", user_id)
    return user_id


async def _request(method: str, path: str, cookies=None, json=None):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.request(method, path, json=json)


# ------------------------------------------------------------- pure units


def test_fingerprint_ignores_ids_and_quoted_values():
    a = monitoring.fingerprint("client", "TypeError: can't read 'name' of player 1234", "/matchups/12")
    b = monitoring.fingerprint("client", "TypeError: can't read 'team' of player 98765", "/matchups/40")
    assert a == b


def test_fingerprint_separates_different_errors_and_sources():
    base = monitoring.fingerprint("client", "TypeError: x is undefined", "/standings")
    assert base != monitoring.fingerprint("client", "RangeError: bad length", "/standings")
    assert base != monitoring.fingerprint("server", "TypeError: x is undefined", "/standings")
    assert base != monitoring.fingerprint("client", "TypeError: x is undefined", "/chat")


@pytest.mark.parametrize("type_", ["admin_crash", "admin_error", "admin_security"])
def test_admin_alerts_ignore_quiet_hours(type_):
    prefs = {
        "quiet_hours_enabled": True,
        "quiet_hours_start": datetime.time(0, 0),
        "quiet_hours_end": datetime.time(23, 59),
        "timezone": "America/Chicago",
    }
    now = datetime.datetime(2026, 9, 28, 12, 0, tzinfo=datetime.timezone.utc)
    action, _ = quiet_hours.decide(prefs, {"data": {"type": type_}}, now)
    assert action == quiet_hours.SEND


# -------------------------------------------------------------- endpoints


@pytest.mark.parametrize("path", ADMIN_READ_PATHS)
async def test_admin_monitoring_reads_require_session(path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    assert (await _request("GET", path)).status_code == 401


@pytest.mark.parametrize("path", ADMIN_READ_PATHS)
async def test_admin_monitoring_reads_reject_non_admins(path, pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    user_id = await _user(pool, admin=False)
    assert (await _request("GET", path, cookies=_cookie(user_id))).status_code == 403


async def test_admin_monitoring_reads_return_their_shapes(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = _cookie(await _user(pool, admin=True))
    expected = {
        "/admin/engagement?days=30": {"summary", "series", "platforms", "when_active", "retention", "cohorts", "funnel"},
        "/admin/live": {"people", "feed", "last_hour"},
        "/admin/paths?days=30": {"transitions", "entries", "exits"},
        "/admin/errors?days=7": {"groups", "occurrences", "kinds"},
        "/admin/security?days=7": {"by_kind", "top_ips", "targeted_accounts", "recent"},
        "/admin/audit": {"total", "entries"},
        "/admin/badges": {"crashes", "errors", "security"},
    }
    for path, keys in expected.items():
        response = await _request("GET", path, cookies=cookies)
        assert response.status_code == 200, path
        assert keys <= set(response.json().keys()), path

    engagement = (await _request("GET", "/admin/engagement?days=7", cookies=cookies)).json()
    assert len(engagement["series"]) == 7
    assert [r["day"] for r in engagement["retention"]] == [1, 7, 30]


async def test_client_error_is_recorded_for_a_signed_out_visitor_and_readable_by_admins(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    marker = f"test-client-error-{uuid.uuid4().hex[:8]}"
    try:
        response = await _request(
            "POST", "/admin/client-error",
            json={"message": f"TypeError: {marker}", "stack": "at foo (app.js:1:1)", "route": "/standings",
                  "platform": "ios", "os": "iOS 16.7", "screen": "375x667@2"},
        )
        assert response.status_code == 200
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM app_errors WHERE message LIKE $1", f"%{marker}%")
        assert row["source"] == "client"
        assert row["owner_id"] is None and row["user_id"] is None
        assert row["os"] == "iOS 16.7"

        cookies = _cookie(await _user(pool, admin=True))
        detail = await _request("GET", f"/admin/errors/{row['fingerprint']}", cookies=cookies)
        assert detail.status_code == 200
        assert detail.json()["occurrences"][0]["stack"] == "at foo (app.js:1:1)"
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM app_errors WHERE message LIKE $1", f"%{marker}%")


async def test_unknown_error_fingerprint_is_a_404(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = _cookie(await _user(pool, admin=True))
    assert (await _request("GET", "/admin/errors/0000000000000000", cookies=cookies)).status_code == 404


async def test_test_requests_are_never_monitored(pool, monkeypatch):
    """The suite's own 403s must not become real security events."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    user_id = await _user(pool, admin=False)
    await _request("GET", "/admin/badges", cookies=_cookie(user_id))
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT count(*) FROM security_events WHERE user_id = $1", user_id)
    assert count == 0


# ------------------------------------------------------------ push alerts


@pytest.fixture
def sent(monkeypatch):
    captured: list[dict] = []

    async def fake_send(conn, payload):
        captured.append(payload)

    monkeypatch.setattr(admin_alerts, "_send", fake_send)
    return captured


async def test_crash_alert_fires_once_per_page_per_hour(pool, sent):
    route = f"/test-crash-{uuid.uuid4().hex[:8]}"
    insert = (
        "INSERT INTO analytics_events (owner_id, session_id, event_name, event_type, route) "
        "VALUES (1, 'test-crash', 'app_crash', 'feature', $1)"
    )
    try:
        async with pool.acquire() as conn:
            await conn.execute(insert, route)
            await admin_alerts.maybe_alert_crash(conn, 1, route, {"os": "iOS 16.7", "screen": "375x667@2"})
            await conn.execute(insert, route)
            await admin_alerts.maybe_alert_crash(conn, 1, route, {})
        assert len(sent) == 1
        assert route in sent[0]["body"] and "iOS 16.7" in sent[0]["body"]
        assert sent[0]["data"] == {"type": "admin_crash", "url": "/admin/crashes", "tag": f"admin-crash-{route}"}
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM analytics_events WHERE route = $1 AND session_id = 'test-crash'", route)


async def test_error_alert_fires_for_a_new_error_and_then_goes_quiet(pool, sent):
    marker = f"test-alert-error-{uuid.uuid4().hex[:8]}"
    try:
        async with pool.acquire() as conn:
            fp = await monitoring.insert_error(conn, source="server", message=f"ValueError: {marker}", stack=None,
                                               route="/admin/things")
            await admin_alerts.maybe_alert_error(conn, fp)
            await monitoring.insert_error(conn, source="server", message=f"ValueError: {marker}", stack=None,
                                          route="/admin/things")
            await admin_alerts.maybe_alert_error(conn, fp)
        assert len(sent) == 1
        assert sent[0]["title"].startswith("🐞 New error (Server)")
        assert sent[0]["url"] == f"/admin/errors?fp={fp}"
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM app_errors WHERE message LIKE $1", f"%{marker}%")


async def test_login_burst_alerts_once_at_the_threshold(pool, sent):
    email = f"test-burst-{uuid.uuid4().hex[:8]}@example.com"
    try:
        async with pool.acquire() as conn:
            for _ in range(admin_alerts.LOGIN_BURST_PER_EMAIL + 2):
                await monitoring.insert_security_event(conn, kind="login_failed", email=email, ip=None)
                await admin_alerts.maybe_alert_login_burst(conn, None, email)
        assert len(sent) == 1
        assert email in sent[0]["body"]
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM security_events WHERE email = $1", email)


async def test_admin_owner_ids_include_explicit_admins(pool):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, 'Test Alert Admin') RETURNING owner_id",
            f"test-alert-admin-{uuid.uuid4().hex[:8]}",
        )
        user_id = await _user(pool, admin=True)
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
        assert owner_id in await admin_alerts.admin_owner_ids(conn)
