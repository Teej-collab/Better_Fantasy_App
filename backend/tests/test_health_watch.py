"""app/notifications/health_watch.py: alert after two bad checks, all
clear after three good ones, never a ping for a one-check blip. Pushes
are captured, not sent."""
import pytest

from app import scheduler_status
from app.notifications import admin_alerts, health_watch


@pytest.fixture
def pushes(monkeypatch):
    sent = []

    async def capture(conn, payload, exclude_owner_id=None):
        sent.append(payload)

    monkeypatch.setattr(admin_alerts, "_send", capture)
    monkeypatch.setattr(scheduler_status, "_ticks", {})
    _espn_refusing(monkeypatch, False)
    health_watch.reset()
    yield sent
    health_watch.reset()


def _espn_refusing(monkeypatch, refusing: bool):
    monkeypatch.setattr(health_watch, "relay_status", lambda: {"using_relay": refusing, "relay_configured": True, "last_refused_at": None})


async def test_alerts_after_two_checks_and_clears_after_three(pool, pushes, monkeypatch):
    async with pool.acquire() as conn:
        _espn_refusing(monkeypatch, True)
        await health_watch.check(conn)
        assert pushes == []
        await health_watch.check(conn)
        assert [p["title"] for p in pushes] == ["🔴 ESPN is refusing the server"]
        assert pushes[0]["data"]["url"] == "/admin/brain"

        # Still refusing: no repeat alert.
        await health_watch.check(conn)
        assert len(pushes) == 1

        _espn_refusing(monkeypatch, False)
        await health_watch.check(conn)
        await health_watch.check(conn)
        assert len(pushes) == 1
        await health_watch.check(conn)
        assert pushes[-1]["title"] == "✅ Back to normal: ESPN is refusing the server"


async def test_a_one_check_blip_never_pings(pool, pushes, monkeypatch):
    async with pool.acquire() as conn:
        _espn_refusing(monkeypatch, True)
        await health_watch.check(conn)
        _espn_refusing(monkeypatch, False)
        for _ in range(4):
            await health_watch.check(conn)
    assert pushes == []


async def test_a_job_failing_three_runs_in_a_row_alerts(pool, pushes, monkeypatch):
    for _ in range(3):
        scheduler_status.record_tick("espn_live_sync", ok=False, error="RuntimeError('ESPN said no')")
    async with pool.acquire() as conn:
        await health_watch.check(conn)
        await health_watch.check(conn)
    assert pushes[0]["title"] == "🔴 Live scoring is failing"
    assert "ESPN said no" in pushes[0]["body"]


async def test_one_failed_waiver_run_alerts(pool, pushes, monkeypatch):
    scheduler_status.record_tick("waiver_processing", ok=False, error="boom")
    async with pool.acquire() as conn:
        await health_watch.check(conn)
        await health_watch.check(conn)
    assert pushes[0]["title"] == "🔴 The waiver run is failing"


async def test_paused_scores_take_priority_over_the_relay(pool, pushes, monkeypatch):
    _espn_refusing(monkeypatch, True)
    monkeypatch.setattr(health_watch, "live_scoreboard_status", lambda: {"serving_fallback": True, "age_seconds": 5, "games_live": 1, "games_today": 14})
    async with pool.acquire() as conn:
        await health_watch.check(conn)
        await health_watch.check(conn)
    assert [p["title"] for p in pushes] == ["🔴 Live scores paused"]
