"""Commissioner Tools overhaul (2026-10-23): the hub summary, waiver
rules, Commish Corner posts (now and scheduled), the change log and who
can read it, and the calendar."""
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from httpx import ASGITransport, AsyncClient

from app.domain import announcements, commish_tools
from app.domain.waiver_settings import defaults_for, get_waiver_settings, next_clear
from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _commissioner_with_league(client: AsyncClient) -> dict:
    tag = uuid.uuid4().hex[:8]
    resp = await client.post(
        "/auth/signup", json={"email": f"test-commish-{tag}@example.com", "password": "correct-horse", "display_name": "Commish Tester"}
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post("/leagues", json={"name": f"Test League Commish {tag}", "make_active": True})
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---- pure ------------------------------------------------------------------


def test_defaults_match_the_rules_every_league_ran_on():
    assert defaults_for("redraft")["waiver_type"] == "reverse"
    guillotine = defaults_for("guillotine", {"faab_budget": 500})
    assert guillotine["waiver_type"] == "faab" and guillotine["faab_budget"] == 500


def test_next_clear_uses_the_leagues_own_day_and_hour():
    et = ZoneInfo("America/New_York")
    monday_noon = datetime(2026, 10, 19, 12, 0, tzinfo=et)
    default = next_clear(monday_noon).astimezone(et)
    assert (default.weekday(), default.hour) == (2, 3)  # Wednesday 3:00 AM
    custom = next_clear(monday_noon, {"clear_weekday": 1, "clear_hour": 23}).astimezone(et)
    assert (custom.weekday(), custom.hour, custom.day) == (1, 23, 20)  # that Tuesday, 11 PM


# ---- endpoints ---------------------------------------------------------------


async def test_hub_summary_and_members(pool):
    async with _client() as client:
        league = await _commissioner_with_league(client)
        resp = await client.get("/league/commish/summary")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["league"]["id"] == league["id"]
        assert body["tools"]["waivers"].startswith("Worst record first")
        assert isinstance(body["needs_you"], list)

        resp = await client.get("/league/commish/members")
        assert resp.status_code == 200
        members = resp.json()["members"]
        assert [m["role"] for m in members] == ["commissioner"]

        review = (await client.get("/league/commish/trades")).json()
        assert review["trades"] == [] and "trade_deadline" in review["settings"]
        waivers = (await client.get("/league/commish/waivers")).json()
        assert waivers["settings"]["custom"] is False and waivers["pending_claims"] == 0


async def test_only_the_commissioner_gets_the_tools(pool):
    async with _client() as commish, _client() as member:
        league = await _commissioner_with_league(commish)
        tag = uuid.uuid4().hex[:8]
        await member.post(
            "/auth/signup", json={"email": f"test-commish-m-{tag}@example.com", "password": "correct-horse", "display_name": "Member"}
        )
        resp = await member.post("/leagues/join", json={"invite_code": league["invite_code"], "make_active": True})
        assert resp.status_code == 200, resp.text
        assert (await member.get("/league/commish/summary")).status_code == 403
        assert (await member.put("/league/commish/waivers", json={"waiver_type": "faab"})).status_code == 403


async def test_waiver_rules_save_apply_and_land_in_the_log(pool):
    async with _client() as client:
        league = await _commissioner_with_league(client)
        resp = await client.put(
            "/league/commish/waivers",
            json={"waiver_type": "faab", "faab_budget": 50, "min_bid": 1, "clear_weekday": 1, "clear_hour": 23,
                  "drop_days": 2, "hold_played": False, "post_results": True},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["settings"]["custom"] is True
        async with pool.acquire() as conn:
            settings = await get_waiver_settings(conn, league["id"])
        assert (settings["waiver_type"], settings["faab_budget"], settings["clear_weekday"]) == ("faab", 50, 1)

        assert (await client.put("/league/commish/waivers", json={"waiver_type": "faab", "faab_budget": 50, "min_bid": 60})).status_code == 400

        log = (await client.get("/league/commish/log")).json()
        assert any(c["summary"].startswith("Waivers: Worst record first → FAAB bids") for c in log["changes"])
        assert all(c["actor_name"] == "Commish Tester" for c in log["changes"])


async def test_post_and_schedule_commish_corner_announcements(pool):
    async with _client() as client:
        league = await _commissioner_with_league(client)
        resp = await client.post("/league/commish/announcements", json={"title": "Deadline moved", "body": "Nov 20 now.", "notify": False})
        assert resp.status_code == 200, resp.text
        message_id = resp.json()["message_id"]
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT m.title, c.type FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1", message_id
            )
        assert (row["title"], row["type"]) == ("Deadline moved", "commish_corner")

        later = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        resp = await client.post("/league/commish/announcements", json={"title": "Playoffs", "body": "Seeds set.", "notify": False, "send_at": later})
        scheduled_id = resp.json()["scheduled_id"]
        assert scheduled_id is not None
        listing = (await client.get("/league/commish/announcements")).json()
        assert [s["id"] for s in listing["scheduled"]] == [scheduled_id]

        async with pool.acquire() as conn:
            await conn.execute("UPDATE scheduled_announcements SET send_at = now() - interval '1 minute' WHERE id = $1", scheduled_id)
            assert await announcements.post_due(conn) >= 1
            sent = await conn.fetchrow("SELECT sent_at, message_id FROM scheduled_announcements WHERE id = $1", scheduled_id)
        assert sent["sent_at"] is not None and sent["message_id"] is not None
        assert (await client.delete(f"/league/commish/announcements/{scheduled_id}")).status_code == 404
        assert league["id"]


async def test_the_league_reads_the_change_log_unless_its_turned_off(pool):
    async with _client() as client:
        await _commissioner_with_league(client)
        await client.put("/league/commish/waivers", json={"waiver_type": "rolling"})
        changes = (await client.get("/league/changes")).json()
        assert changes["public"] is True and changes["changes"]
        await client.put("/league/commish/log/visibility", json={"public": False})
        assert (await client.get("/league/changes")).json() == {"public": False, "changes": []}


async def test_calendar_lists_the_leagues_dates(pool, monkeypatch):
    kickoff = datetime(2026, 9, 10, 0, 20, tzinfo=timezone.utc)

    async def kickoffs(season):
        return {w: kickoff + timedelta(weeks=w - 1) for w in range(1, 19)}

    monkeypatch.setattr(commish_tools, "week_kickoffs", kickoffs)
    async with _client() as client:
        await _commissioner_with_league(client)
        resp = await client.get("/league/commish/calendar")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        keys = [i["key"] for i in body["items"]]
        assert "trade_deadline" in keys and "waivers" in keys and "playoffs_start" in keys
        assert body["week_kickoffs"]["1"].startswith("2026-09-10")
