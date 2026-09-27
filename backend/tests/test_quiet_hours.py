"""Tests for app/notifications/quiet_hours.py (pure) and the
dispatcher's enforcement of it — send_to_owner holding, dropping, or
sending, and flush_deferred sending what was held. Device delivery is
patched out, same as tests/test_fantasy_events.py."""
import datetime
from zoneinfo import ZoneInfo

from app.notifications import dispatcher, formatter, quiet_hours
from app.queries import owner_preferences as preferences_queries

CHICAGO = ZoneInfo("America/Chicago")


def _prefs(start=datetime.time(22, 0), end=datetime.time(8, 0), enabled=True, tz=None):
    return {"quiet_hours_enabled": enabled, "quiet_hours_start": start, "quiet_hours_end": end, "timezone": tz}


def _at(hour, minute=0, tz=CHICAGO, day=27):
    return datetime.datetime(2026, 9, day, hour, minute, tzinfo=tz)


def test_overnight_window_covers_both_sides_of_midnight():
    prefs = _prefs()
    assert quiet_hours.quiet_until(prefs, _at(23)) == _at(8, day=28)
    assert quiet_hours.quiet_until(prefs, _at(3)) == _at(8)
    assert quiet_hours.quiet_until(prefs, _at(8)) is None
    assert quiet_hours.quiet_until(prefs, _at(21, 59)) is None


def test_same_day_window():
    prefs = _prefs(start=datetime.time(13, 0), end=datetime.time(15, 0))
    assert quiet_hours.quiet_until(prefs, _at(14)) == _at(15)
    assert quiet_hours.quiet_until(prefs, _at(16)) is None


def test_disabled_or_empty_window_is_never_quiet():
    assert quiet_hours.quiet_until(_prefs(enabled=False), _at(23)) is None
    assert quiet_hours.quiet_until(_prefs(start=datetime.time(9), end=datetime.time(9)), _at(9)) is None


def test_window_is_read_in_the_owners_timezone():
    prefs = _prefs(tz="America/New_York")
    # 9:30 PM Central is 10:30 PM Eastern — quiet for an Eastern owner,
    # not for the default (Central) one.
    assert quiet_hours.quiet_until(prefs, _at(21, 30)) is not None
    assert quiet_hours.quiet_until(_prefs(), _at(21, 30)) is None


def test_bad_timezone_falls_back_to_central():
    assert quiet_hours.quiet_until(_prefs(tz="Not/AZone"), _at(23)) == _at(8, day=28)


def test_decide_by_notification_type():
    prefs, night = _prefs(), _at(23)
    injury = formatter.injury_update("A", "downgrade", "Out", "Questionable", None, None, tag="injury-1")
    touchdown = formatter.fantasy_player_touchdown("A", "T", "rush_td", 6.0, 1, on_bench=False, tag="td-1")
    assert quiet_hours.decide(prefs, injury, night) == (quiet_hours.DEFER, _at(8, day=28))
    assert quiet_hours.decide(prefs, touchdown, night) == (quiet_hours.DROP, None)
    assert quiet_hours.decide(prefs, formatter.draft_on_the_clock(1, 1, 60), night) == (quiet_hours.SEND, None)
    assert quiet_hours.decide(prefs, formatter.test_notification(), night) == (quiet_hours.SEND, None)
    assert quiet_hours.decide(prefs, touchdown, _at(12)) == (quiet_hours.SEND, None)


def test_is_valid_timezone():
    assert quiet_hours.is_valid_timezone("America/Los_Angeles")
    assert not quiet_hours.is_valid_timezone("Pacific Time")


async def _seed_owner(pool, suffix, **prefs):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-quiethours-owner-{suffix}", f"Owner {suffix}",
        )
        await preferences_queries.update_preferences(conn, owner_id, prefs)
    return owner_id


def _capture_deliveries(monkeypatch):
    delivered = []

    async def _no_subs(conn, owner_id):
        delivered.append(owner_id)
        return []

    monkeypatch.setattr(dispatcher.queries, "list_active_subscriptions_for_owner", _no_subs)

    async def _no_native(conn, owner_id):
        return []

    monkeypatch.setattr(dispatcher.native_queries, "list_active_registrations_for_owner", _no_native)
    return delivered


async def test_send_to_owner_holds_injury_news_and_drops_touchdowns_in_quiet_hours(pool, monkeypatch):
    owner_id = await _seed_owner(pool, "hold", quiet_hours_enabled=True)
    delivered = _capture_deliveries(monkeypatch)
    night = _at(23)

    async with pool.acquire() as conn:
        await dispatcher.send_to_owner(conn, owner_id, formatter.player_news("A", "Full practice.", tag="news-1"), now=night)
        await dispatcher.send_to_owner(
            conn, owner_id, formatter.fantasy_player_touchdown("A", "T", None, None, None, False, tag="td-1"), now=night,
        )
        held = await conn.fetch("SELECT payload, send_after FROM deferred_notifications WHERE owner_id = $1", owner_id)

    assert delivered == []
    assert len(held) == 1
    assert held[0]["send_after"] == _at(8, day=28)


async def test_flush_deferred_sends_once_quiet_hours_end_and_collapses_a_pile(pool, monkeypatch):
    owner_id = await _seed_owner(pool, "flush", quiet_hours_enabled=True)
    sent = []

    async def _fake_deliver(conn, oid, payload, now=None):
        sent.append(payload)
        return 1

    night = _at(23)
    async with pool.acquire() as conn:
        for i in range(5):
            await dispatcher.send_to_owner(conn, owner_id, formatter.player_news(f"P{i}", "News.", tag=f"news-{i}"), now=night)
        # A second update about the same player replaces the first.
        await dispatcher.send_to_owner(conn, owner_id, formatter.player_news("P0", "Newer.", tag="news-0"), now=night)

        monkeypatch.setattr(dispatcher, "send_to_owner", _fake_deliver)
        assert await dispatcher.flush_deferred(conn, now=_at(7, day=28)) == 0
        assert await dispatcher.flush_deferred(conn, now=_at(8, day=28)) == 1
        remaining = await conn.fetchval("SELECT count(*) FROM deferred_notifications WHERE owner_id = $1", owner_id)

    assert remaining == 0
    assert len(sent) == 1
    assert sent[0]["title"] == "🩹 5 player updates overnight"
