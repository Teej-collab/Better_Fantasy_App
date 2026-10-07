"""Sign in with Apple, chat report/block, and the chug house rule
(migration d6f8a0b2c4e7)."""
import uuid

from app.auth import apple_signin
from app.domain.chat import get_conversation_messages
from app.notifications import admin_alerts
from app.queries import chat as chat_queries
from tests.test_chat import (
    _SESSION_SECRET,
    _client,
    _league_session_cookie,
    _seed_direct_conversation,
    _seed_league_owner,
    _seed_owner,
    _seed_team,
    _session_cookie,
)
from tests.conftest import TEST_SEASON


# ---- Sign in with Apple ----------------------------------------------------


async def test_apple_sign_in_creates_then_reuses_account(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    sub = f"test-apple-{uuid.uuid4().hex}"
    monkeypatch.setattr(apple_signin, "verify_identity_token", lambda token: {"sub": sub, "email": None})
    try:
        async with _client() as client:
            first = await client.post("/auth/apple/native", json={"identity_token": "x", "full_name": "Pat Apple"})
            second = await client.post("/auth/apple/native", json={"identity_token": "x"})
        assert first.status_code == 200 and first.json()["token"]
        assert second.status_code == 200
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT display_name FROM users WHERE apple_user_id = $1", sub)
        assert [r["display_name"] for r in rows] == ["Pat Apple"]
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM users WHERE apple_user_id = $1", sub)


async def test_apple_sign_in_rejects_bad_token(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)

    def bad(token):
        raise apple_signin.AppleTokenError("nope")

    monkeypatch.setattr(apple_signin, "verify_identity_token", bad)
    async with _client() as client:
        resp = await client.post("/auth/apple/native", json={"identity_token": "forged"})
    assert resp.status_code == 401


async def test_apple_sign_in_never_links_onto_a_password_account(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    email = f"test-apple-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"test-apple-{uuid.uuid4().hex}"
    async with pool.acquire() as conn:
        pw_user = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Pw') RETURNING id", email
        )
    monkeypatch.setattr(
        apple_signin, "verify_identity_token", lambda token: {"sub": sub, "email": email, "email_verified": "true"}
    )
    try:
        async with _client() as client:
            resp = await client.post("/auth/apple/native", json={"identity_token": "x"})
        assert resp.status_code == 200
        async with pool.acquire() as conn:
            apple_user = await conn.fetchrow("SELECT id, email FROM users WHERE apple_user_id = $1", sub)
        assert apple_user["id"] != pw_user
        assert apple_user["email"] is None
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM users WHERE apple_user_id = $1", sub)


# ---- report / block --------------------------------------------------------


async def test_block_hides_messages_and_unblock_restores_them(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 501)
    b = await _seed_owner(pool, 502)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, conversation_id, b, "from b", None)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        assert (await client.post(f"/chat/blocks/{b}")).status_code == 200
        hidden = (await client.get(f"/chat/conversations/{conversation_id}/messages")).json()["messages"]
        listed = (await client.get("/chat/blocks")).json()["blocked"]
        assert (await client.delete(f"/chat/blocks/{b}")).status_code == 200
        shown = (await client.get(f"/chat/conversations/{conversation_id}/messages")).json()["messages"]

    assert hidden == []
    assert [x["owner_id"] for x in listed] == [b]
    assert [m["body"] for m in shown] == ["from b"]


async def test_block_only_hides_for_the_blocker(pool):
    a = await _seed_owner(pool, 503)
    b = await _seed_owner(pool, 504)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        await chat_queries.insert_message(conn, conversation_id, a, "from a", None)
        await conn.execute("INSERT INTO owner_blocks (blocker_owner_id, blocked_owner_id) VALUES ($1, $2)", b, a)
        a_view = await get_conversation_messages(conn, conversation_id, None, 50, a)
        b_view = await get_conversation_messages(conn, conversation_id, None, 50, b)
    assert [m["body"] for m in a_view] == ["from a"]
    assert b_view == []


async def test_cannot_block_yourself(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 505)
    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        resp = await client.post(f"/chat/blocks/{a}")
    assert resp.status_code == 400


async def test_report_message_records_once_and_alerts_admins(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    alerts = []

    async def fake_alert(conn, reporter, reported, reason, reporter_owner_id):
        alerts.append((reporter, reported, reason))

    monkeypatch.setattr(admin_alerts, "alert_chat_report", fake_alert)
    a = await _seed_owner(pool, 506)
    b = await _seed_owner(pool, 507)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        row = await chat_queries.insert_message(conn, conversation_id, b, "rude", None)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, a))
        bad_reason = await client.post(f"/chat/messages/{row['id']}/report", json={"reason": "meh"})
        first = await client.post(f"/chat/messages/{row['id']}/report", json={"reason": "harassment"})
        again = await client.post(f"/chat/messages/{row['id']}/report", json={"reason": "harassment"})

    assert bad_reason.status_code == 400
    assert first.status_code == 200 and again.status_code == 200
    assert alerts == [("Chatter 506", "Chatter 507", "harassment")]
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT count(*) FROM message_reports WHERE message_id = $1", row["id"])
    assert count == 1


async def test_cannot_report_a_message_in_a_conversation_you_cant_see(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, 508)
    b = await _seed_owner(pool, 509)
    outsider = await _seed_owner(pool, 510)
    conversation_id = await _seed_direct_conversation(pool, a, b)
    async with pool.acquire() as conn:
        row = await chat_queries.insert_message(conn, conversation_id, b, "private", None)
    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, outsider))
        resp = await client.post(f"/chat/messages/{row['id']}/report", json={"reason": "spam"})
    assert resp.status_code == 403


# ---- chug house rule --------------------------------------------------------


async def test_house_rules_are_commissioner_only_and_default_off(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    c_user, c_owner, league_id = await _seed_league_owner(pool, 520, role="commissioner")
    m_user, m_owner, _ = await _seed_league_owner(pool, 521, league_id=league_id)

    async with _client() as client:
        client.cookies.update(_league_session_cookie(m_user, m_owner))
        mine = (await client.get("/leagues/mine")).json()["leagues"]
        member_try = await client.patch(f"/leagues/{league_id}/house-rules", json={"chug_enabled": True})

        client.cookies.update(_league_session_cookie(c_user, c_owner))
        turned_on = await client.patch(
            f"/leagues/{league_id}/house-rules", json={"chug_enabled": True, "chug_rule_name": "  Shotgun Sunday  "}
        )

    league = next(l for l in mine if l["id"] == league_id)
    assert league["chug_enabled"] is False
    assert member_try.status_code == 403
    assert turned_on.status_code == 200
    assert turned_on.json()["chug_enabled"] is True
    assert turned_on.json()["chug_rule_name"] == "Shotgun Sunday"


async def test_chug_deadline_is_off_when_the_house_rule_is_off(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, league_id = await _seed_league_owner(pool, 522, role="commissioner")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed, league_id) VALUES ($1, 1, $2, 1, $3)",
            TEST_SEASON, owner_id, league_id,
        )
    async with _client() as client:
        client.cookies.update(_league_session_cookie(user_id, owner_id))
        resp = await client.get("/chug/deadline")
    assert resp.status_code == 200
    assert resp.json()["deadline"] is None
