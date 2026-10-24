"""The 2027 waitlist (app/routers/waitlist.py)."""
from httpx import ASGITransport, AsyncClient

from app.auth import rate_limit
from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_signup_saves_once_per_email_and_updates(pool, monkeypatch):
    rate_limit._attempts.clear()
    async with _client() as client:
        first = await client.post(
            "/waitlist",
            json={"email": "Test-Waitlist@Example.com", "league_size": 12, "platform": "espn", "ref": "share-recap"},
        )
        again = await client.post("/waitlist", json={"email": "test-waitlist@example.com", "name": "Sam", "ref": "direct"})
        bad = await client.post("/waitlist", json={"email": "not-an-email"})
    assert first.status_code == 200, first.text
    assert again.status_code == 200
    assert bad.status_code == 400
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM waitlist_signups WHERE lower(email) = 'test-waitlist@example.com'")
        await conn.execute("DELETE FROM waitlist_signups WHERE lower(email) = 'test-waitlist@example.com'")
    assert len(rows) == 1
    assert rows[0]["name"] == "Sam"
    assert rows[0]["league_size"] == 12
    assert rows[0]["ref"] == "share-recap"  # the first place they came from sticks


async def test_admin_list_needs_a_signed_in_admin(pool):
    async with _client() as client:
        resp = await client.get("/admin/waitlist")
    assert resp.status_code == 401
