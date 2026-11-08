"""The notification overhaul (2026-11-08): the inbox (app/routers/
notifications.py, dispatcher.record), the newer switches, pushes that
wait out quiet hours instead of being dropped, iPhone collapse ids /
time-sensitive / buttons, and the survivor reminder's "Pick best odds"."""
import datetime
from datetime import UTC, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.domain import survivor
from app.notifications import apns_client, dispatcher, formatter, quiet_hours
from app.queries import owner_preferences as preferences_queries
from tests.conftest import TEST_SEASON
from tests.test_survivor import _client, _fake_schedule, _game, _signup

CHICAGO = ZoneInfo("America/Chicago")
NIGHT = datetime.datetime(2026, 9, 27, 23, 0, tzinfo=CHICAGO)
NOON = datetime.datetime(2026, 9, 27, 12, 0, tzinfo=CHICAGO)


async def _seed_owner(pool, suffix, **prefs):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-inbox-owner-{suffix}", f"Owner {suffix}",
        )
        if prefs:
            await preferences_queries.update_preferences(conn, owner_id, prefs)
    return owner_id


def _no_devices(monkeypatch):
    async def none(conn, owner_id):
        return []

    monkeypatch.setattr(dispatcher.queries, "list_active_subscriptions_for_owner", none)
    monkeypatch.setattr(dispatcher.native_queries, "list_active_registrations_for_owner", none)


async def _inbox(conn, owner_id):
    return await conn.fetch("SELECT type, title, tag, read_at FROM notifications WHERE owner_id = $1 ORDER BY id", owner_id)


async def test_the_inbox_keeps_pushes_and_a_tag_replaces_the_earlier_one(pool, monkeypatch):
    owner_id = await _seed_owner(pool, "keep")
    _no_devices(monkeypatch)
    async with pool.acquire() as conn:
        await dispatcher.send_to_owner(conn, owner_id, formatter.trade_offer("Team A", "Your WR for their RB", 41), now=NOON)
        lead = formatter.fantasy_matchup_lead_change
        await dispatcher.send_to_owner(conn, owner_id, lead(True, "Team B", 80.0, 79.0, 7), now=NOON)
        await conn.execute("UPDATE notifications SET read_at = now() WHERE owner_id = $1", owner_id)
        await dispatcher.send_to_owner(conn, owner_id, lead(False, "Team B", 80.0, 81.0, 7), now=NOON)
        # A plain chat message isn't kept (the chat list is its inbox).
        await dispatcher.send_to_owner(conn, owner_id, formatter.chat_league_message("Sam", "lol", 3), now=NOON)
        rows = await _inbox(conn, owner_id)
    assert [r["type"] for r in rows] == ["trade", "fantasy_matchup_lead_change"]
    # The flip replaced the first lead change, and it's unread again.
    assert rows[1]["read_at"] is None


async def test_the_newer_switches_mute_their_pushes(pool, monkeypatch):
    owner_id = await _seed_owner(pool, "mute", notify_trades=False)
    _no_devices(monkeypatch)
    async with pool.acquire() as conn:
        assert await dispatcher.send_to_owner(conn, owner_id, formatter.trade_offer("Team A", "x", 42), now=NOON) == 0
        await dispatcher.send_to_owner(conn, owner_id, formatter.friend_request("Pat", 9), now=NOON)
        assert [r["type"] for r in await _inbox(conn, owner_id)] == ["friend"]


async def test_quiet_hours_hold_things_waiting_on_you_and_skip_them_once_stale(pool, monkeypatch):
    prefs = {"quiet_hours_enabled": True, "quiet_hours_start": datetime.time(22), "quiet_hours_end": datetime.time(8), "timezone": None}
    morning = datetime.datetime(2026, 9, 28, 8, 0, tzinfo=CHICAGO)
    assert quiet_hours.decide(prefs, formatter.trade_offer("A", "x", 1), NIGHT) == (quiet_hours.DEFER, morning)
    assert quiet_hours.decide(prefs, formatter.friend_request("A", 1), NIGHT)[0] == quiet_hours.DEFER

    owner_id = await _seed_owner(pool, "stale", quiet_hours_enabled=True)
    _no_devices(monkeypatch)
    sent = []

    async def fake_deliver(conn, oid, payload, now=None, keep=True):
        sent.append(payload["data"]["type"])
        return 1

    lock = datetime.datetime(2026, 9, 28, 6, 30, tzinfo=CHICAGO)  # locks before quiet hours end
    async with pool.acquire() as conn:
        await dispatcher.send_to_owner(conn, owner_id, formatter.survivor_pick_needed("Pool", 3, 3, 1, 5, lock), now=NIGHT)
        await dispatcher.send_to_owner(conn, owner_id, formatter.trade_offer("A", "x", 43), now=NIGHT)
        monkeypatch.setattr(dispatcher, "send_to_owner", fake_deliver)
        await dispatcher.flush_deferred(conn, now=morning)
        # Both are in the inbox either way.
        assert {r["type"] for r in await _inbox(conn, owner_id)} == {"survivor_pick_needed", "trade"}
    assert sent == ["trade"]


async def test_iphone_pushes_carry_collapse_id_buttons_and_time_sensitive(monkeypatch):
    requests = []

    class FakeClient:
        async def send_notification(self, request):
            requests.append(request)
            return SimpleNamespace(is_successful=True)

    monkeypatch.setattr(apns_client, "_get_client", lambda sandbox=False: FakeClient())
    await apns_client.send_apns("tok", formatter.trade_offer("A", "x", 44))
    await apns_client.send_apns("tok", formatter.draft_on_the_clock(1, 1, 60))
    trade, draft = requests
    assert trade.collapse_key == "trade-44"
    assert trade.message["aps"]["category"] == "trade_offer" and trade.message["data"]["trade_id"] == 44
    assert "interruption-level" not in trade.message["aps"]
    assert draft.message["aps"]["interruption-level"] == "time-sensitive"
    assert draft.collapse_key is None


async def test_survivor_reminder_lands_in_the_inbox_and_picks_best_odds(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    kickoff = datetime.datetime.now(UTC) + timedelta(hours=2)
    _fake_schedule(monkeypatch, {"week": 6, "weeks": {6: [_game("JAX", "TEN", kickoff), _game("SF", "DAL", kickoff + timedelta(hours=3))]}})
    async with _client() as a:
        await _signup(a, "golf")
        made = (await a.post("/survivor/pools", json={"name": "Inbox Pool"})).json()
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO nfl_game_lines (season, week, team, opponent, is_home, spread) VALUES ($1, 6, $2, $3, $4, $5)",
                [(TEST_SEASON, "JAX", "TEN", False, 3.0), (TEST_SEASON, "TEN", "JAX", True, -3.0),
                 (TEST_SEASON, "SF", "DAL", False, -9.5), (TEST_SEASON, "DAL", "SF", True, 9.5)],
            )
            due = [r for r in await survivor.due_reminders(conn, TEST_SEASON) if r["pool_id"] == made["id"]]
            assert len(due) == 1
            r = due[0]
            await dispatcher.send_to_user(
                conn, r["user_id"], formatter.survivor_pick_needed(r["pool_name"], r["week"], r["hours"], r["pool_id"], r["entry_id"], r["lock"]),
            )
        inbox = (await a.get("/notifications")).json()
        assert inbox["unread"] == 1
        item = inbox["notifications"][0]
        assert item["data"]["category"] == "survivor_pick" and item["data"]["entry_id"] == r["entry_id"]
        picked = await a.post(f"/survivor/entries/{r['entry_id']}/best-pick")
        assert picked.status_code == 200, picked.text
        assert picked.json()["teams"] == ["SF"]
        # Already picked: nothing left to fill.
        assert (await a.post(f"/survivor/entries/{r['entry_id']}/best-pick")).status_code == 409
        assert (await a.post("/notifications/read", json={})).json()["unread"] == 0


async def test_a_survivor_reminder_waits_for_quiet_hours_to_end(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    kickoff = datetime.datetime.now(UTC) + timedelta(hours=2)
    _fake_schedule(monkeypatch, {"week": 8, "weeks": {8: [_game("KC", "ATL", kickoff)]}})
    async with _client() as a:
        await _signup(a, "hotel")
        made = (await a.post("/survivor/pools", json={"name": "Quiet Pool"})).json()
    quiet = {"on": True}

    async def can_send(user_id):
        return not quiet["on"]

    async with pool.acquire() as conn:
        assert not [r for r in await survivor.due_reminders(conn, TEST_SEASON, can_send=can_send) if r["pool_id"] == made["id"]]
        quiet["on"] = False
        assert [r for r in await survivor.due_reminders(conn, TEST_SEASON, can_send=can_send) if r["pool_id"] == made["id"]]


async def test_a_league_set_to_just_my_team_or_muted(pool, monkeypatch):
    owner_id = await _seed_owner(pool, "levels")
    _no_devices(monkeypatch)
    delivered = []

    async def capture(conn, oid):
        delivered.append(oid)
        return []

    monkeypatch.setattr(dispatcher.queries, "list_active_subscriptions_for_owner", capture)
    async with pool.acquire() as conn:
        league_id = await conn.fetchval(
            "INSERT INTO leagues (name, created_by_user_id, invite_code) "
            "VALUES ('Test Levels League', (SELECT id FROM users LIMIT 1), 'TSTLVL') RETURNING id"
        )
        try:
            chatter = dispatcher.in_league(formatter.chug_posted("Sam", 8.5, False), league_id, league_wide=True)
            mine = dispatcher.in_league(formatter.matchup_final("win", "Team B", 110.0, 90.0, "5-4", 3), league_id)
            await conn.execute("INSERT INTO league_notification_levels (owner_id, league_id, level) VALUES ($1, $2, 'mine')", owner_id, league_id)
            await dispatcher.send_to_owner(conn, owner_id, chatter, now=NOON)
            await dispatcher.send_to_owner(conn, owner_id, mine, now=NOON)
            assert len(delivered) == 1
            await conn.execute("UPDATE league_notification_levels SET level = 'off' WHERE owner_id = $1", owner_id)
            await dispatcher.send_to_owner(conn, owner_id, mine, now=NOON)
            # Muted, but the draft clock still reaches you.
            await dispatcher.send_to_owner(conn, owner_id, dispatcher.in_league(formatter.draft_on_the_clock(1, 1, 60), league_id), now=NOON)
            assert len(delivered) == 2
            # Everything still lands in the inbox.
            assert {r["type"] for r in await _inbox(conn, owner_id)} == {"chug_posted", "matchup_final", "draft_on_the_clock"}
        finally:
            await conn.execute("DELETE FROM league_notification_levels WHERE league_id = $1", league_id)
            await conn.execute("DELETE FROM leagues WHERE id = $1", league_id)


async def test_reply_from_a_chat_push(pool, monkeypatch):
    from app.queries import chat as chat_queries
    from tests.test_chat import _SESSION_SECRET, _session_cookie
    from tests.test_chat import _seed_owner as seed_chat_owner

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a, b = await seed_chat_owner(pool, "reply-a"), await seed_chat_owner(pool, "reply-b")
    async with pool.acquire() as conn:
        conversation_id = await chat_queries.get_or_create_direct_conversation(conn, a, b)
    push = formatter.chat_direct_message("A", "you up?", conversation_id)
    assert push["data"]["category"] == "chat_message" and push["data"]["conversation_id"] == conversation_id
    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, b))
        sent = await client.post(f"/chat/conversations/{conversation_id}/reply", json={"body": "always"})
        assert sent.status_code == 200, sent.text
        assert (await client.post(f"/chat/conversations/{conversation_id}/reply", json={"body": "  "})).status_code == 400
    async with pool.acquire() as conn:
        assert await conn.fetchval("SELECT body FROM messages WHERE id = $1", sent.json()["message_id"]) == "always"


async def test_admin_correction_replaces_the_wrong_push(pool, monkeypatch):
    from tests.test_admin import _SESSION_SECRET, _explicit_admin_cookies

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    _no_devices(monkeypatch)
    owner_id = await _seed_owner(pool, "correct")
    wrong = dispatcher.in_league(formatter.inactive_starter("Breece Hall", "1:00 PM ET", "inactive-9-2026-10-1-p3"), 9)
    async with pool.acquire() as conn:
        await dispatcher.send_to_owner(conn, owner_id, wrong)
    ask = {"type": "inactive_starter", "title_contains": "Breece Hall", "title": "✅ Breece Hall is active", "body": "Ignore the last alert."}
    async with _client() as client:
        assert (await client.post("/admin/notifications/correct", json=ask)).status_code == 401
        client.cookies.update(await _explicit_admin_cookies(pool, "correct-admin"))
        dry = (await client.post("/admin/notifications/correct", json=ask)).json()
        assert [r["owner_id"] for r in dry["recipients"]] == [owner_id]
        async with pool.acquire() as conn:
            assert [r["title"] for r in await _inbox(conn, owner_id)] == ["🚫 Breece Hall is INACTIVE"]
        sent = await client.post("/admin/notifications/correct", json={**ask, "dry_run": False})
        assert sent.status_code == 200, sent.text
    async with pool.acquire() as conn:
        assert [r["title"] for r in await _inbox(conn, owner_id)] == ["✅ Breece Hall is active"]
