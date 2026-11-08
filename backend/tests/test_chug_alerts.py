"""The chug rule's pushes and the inbox banner (app/notifications/
chug_alerts.py, GET /notifications/chugs)."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import DEFAULT_LEAGUE_ID
from app.domain.chug_standing import accrue_weekly_debt, ensure_chug_deadline_settled
from app.notifications import chug_alerts, formatter
from tests.conftest import TEST_SEASON

ET = ZoneInfo("America/New_York")
_GAMES = [{"name": "irrelevant", "date": "2026-08-21T00:00Z"}]
_AFTER_DEADLINE = datetime(2026, 8, 24, 23, 0, tzinfo=ET)
_DEADLINE = datetime(2026, 8, 24, 20, 15, tzinfo=ET)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-chugalerts-owner-{suffix}", f"Owner {suffix}",
        )


async def _owe(pool, owner_id, week, chugs):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, $2, $3, $4)",
            TEST_SEASON, week, owner_id, chugs,
        )
        await accrue_weekly_debt(conn, TEST_SEASON, week)


def _capture(monkeypatch):
    sent = []

    async def fake_send(conn, owner_id, payload, category, league_id=None):
        sent.append((owner_id, payload))

    monkeypatch.setattr(chug_alerts, "_send", fake_send)
    return sent


async def test_you_owe_goes_once_with_the_running_total(pool, monkeypatch):
    sent = _capture(monkeypatch)
    owner_id = await _seed_owner(pool, "owe")
    await _owe(pool, owner_id, 1, 1)
    await _owe(pool, owner_id, 2, 2)
    async with pool.acquire() as conn:
        await chug_alerts.notify_chugs_owed(conn, TEST_SEASON, 2, DEFAULT_LEAGUE_ID)
        await chug_alerts.notify_chugs_owed(conn, TEST_SEASON, 2, DEFAULT_LEAGUE_ID)
    mine = [p for o, p in sent if o == owner_id]
    assert [p["title"] for p in mine] == ["🍺 You owe 2 chugs from Week 2"]
    assert "You owe 3 in all" in mine[0]["body"]


async def test_reminder_only_in_the_hours_before_kickoff_and_not_for_this_weeks_own(pool, monkeypatch):
    sent = _capture(monkeypatch)
    owner_id = await _seed_owner(pool, "remind")
    await _owe(pool, owner_id, 3, 2)
    await _owe(pool, owner_id, 4, 1)  # earned this week: due next Monday
    async with pool.acquire() as conn:
        await chug_alerts.remind_deadline(conn, TEST_SEASON, 4, DEFAULT_LEAGUE_ID, _DEADLINE, _DEADLINE - timedelta(hours=8))
        assert not [o for o, _ in sent if o == owner_id]
        await chug_alerts.remind_deadline(conn, TEST_SEASON, 4, DEFAULT_LEAGUE_ID, _DEADLINE, _DEADLINE - timedelta(hours=2))
        await chug_alerts.remind_deadline(conn, TEST_SEASON, 4, DEFAULT_LEAGUE_ID, _DEADLINE, _DEADLINE - timedelta(hours=1))
    mine = [p for o, p in sent if o == owner_id]
    assert [p["title"] for p in mine] == ["⏰ 2 chugs due by kickoff tonight"]
    assert mine[0]["body"] == "Post by 8:15 PM ET or it doubles to 4."
    assert mine[0]["data"]["expires"] == _DEADLINE.isoformat()


async def test_doubled_after_the_deadline(pool, monkeypatch):
    sent = _capture(monkeypatch)
    owner_id = await _seed_owner(pool, "double")
    await _owe(pool, owner_id, 5, 2)
    await ensure_chug_deadline_settled(pool, TEST_SEASON, 6, _GAMES, now=_AFTER_DEADLINE)
    await ensure_chug_deadline_settled(pool, TEST_SEASON, 6, _GAMES, now=_AFTER_DEADLINE)
    assert [p["title"] for o, p in sent if o == owner_id] == ["🍺 Your 2 chugs doubled to 4"]


def test_fined_copy():
    push = formatter.chug_settled("fined", 4, 0, 40, "k")
    assert push["title"] == "💸 Your 4 chugs became a $40 fine"


async def test_inbox_banner_shows_what_you_owe(pool, monkeypatch):
    from tests.test_chat import _SESSION_SECRET, _session_cookie
    from tests.test_survivor import _client

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, "banner")
    await _owe(pool, owner_id, 7, 3)
    async with pool.acquire() as conn:
        was = await conn.fetchval("SELECT chug_enabled FROM leagues WHERE id = $1", DEFAULT_LEAGUE_ID)
        await conn.execute("UPDATE leagues SET chug_enabled = TRUE WHERE id = $1", DEFAULT_LEAGUE_ID)
    try:
        async with _client() as client:
            client.cookies.update(await _session_cookie(pool, owner_id))
            res = await client.get("/notifications/chugs")
        assert res.status_code == 200, res.text
        assert [(c["league_id"], c["owed"], c["fine"]) for c in res.json()["chugs"]] == [(DEFAULT_LEAGUE_ID, 3, 0)]
    finally:
        async with pool.acquire() as conn:
            await conn.execute("UPDATE leagues SET chug_enabled = $2 WHERE id = $1", DEFAULT_LEAGUE_ID, was)
