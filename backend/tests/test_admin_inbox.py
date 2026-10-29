"""Admin inbox (app/queries/admin_inbox.py): the feed of what needs a
person, and claiming / marking done so two admins don't double up.
Every row a test writes is tagged and deleted by that test."""
import uuid

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _cookie(user_id: int) -> dict:
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id, owner_id=1)}


async def _user(pool, *, admin: bool, name: str = "Test Inbox") -> int:
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name, is_admin) VALUES ($1, 'x', $2, $3) RETURNING id",
            f"test-inbox-{uuid.uuid4().hex[:12]}@example.com", name, admin,
        )


async def _request(method: str, path: str, cookies=None, json=None):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.request(method, path, json=json)


async def test_inbox_is_admin_only(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    assert (await _request("GET", "/admin/inbox")).status_code == 401
    user_id = await _user(pool, admin=False)
    assert (await _request("GET", "/admin/inbox", cookies=_cookie(user_id))).status_code == 403
    assert (await _request("POST", "/admin/inbox/claim", cookies=_cookie(user_id), json={"kind": "error", "ref": "x"})).status_code == 403


async def test_claim_done_and_an_error_coming_back(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    marker = f"test-inbox-{uuid.uuid4().hex[:8]}"
    tj = await _user(pool, admin=True, name="TJ Test")
    niko = await _user(pool, admin=True, name="Niko Test")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO app_errors (source, fingerprint, message, route) VALUES ('client', $1, $2, '/keepers')",
            marker, f"TypeError: {marker}",
        )
    try:
        def find(body):
            return next(i for i in body["items"] if i["kind"] == "error" and i["ref"] == marker)

        item = find((await _request("GET", "/admin/inbox", cookies=_cookie(tj))).json())
        assert item["claimed_by"] is None and item["done"] is False
        assert item["link"] == {"screen": "error", "id": marker}

        assert (await _request("POST", "/admin/inbox/claim", cookies=_cookie(niko), json={"kind": "error", "ref": marker})).status_code == 200
        body = (await _request("GET", "/admin/inbox", cookies=_cookie(tj))).json()
        assert body["me"] == tj
        assert find(body)["claimed_by"] == {"user_id": niko, "name": "Niko Test"}

        await _request("POST", "/admin/inbox/done", cookies=_cookie(tj), json={"kind": "error", "ref": marker})
        item = find((await _request("GET", "/admin/inbox", cookies=_cookie(tj))).json())
        assert item["done"] is True and item["done_by"] == "TJ Test"
        assert item["claimed_by"]["user_id"] == niko  # done keeps who had it

        # It happens again after it was marked done: back in the open.
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO app_errors (source, fingerprint, message, created_at) VALUES ('client', $1, $2, now() + interval '1 second')",
                marker, f"TypeError: {marker}",
            )
        assert find((await _request("GET", "/admin/inbox", cookies=_cookie(tj))).json())["done"] is False

        await _request("POST", "/admin/inbox/unclaim", cookies=_cookie(tj), json={"kind": "error", "ref": marker})
        assert find((await _request("GET", "/admin/inbox", cookies=_cookie(tj))).json())["claimed_by"] is None
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM app_errors WHERE fingerprint = $1", marker)
            await conn.execute("DELETE FROM admin_inbox_claims WHERE ref = $1", marker)
            await conn.execute("DELETE FROM users WHERE id = ANY($1::int[])", [tj, niko])


async def test_unknown_kind_is_refused(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    admin = await _user(pool, admin=True)
    response = await _request("POST", "/admin/inbox/claim", cookies=_cookie(admin), json={"kind": "nope", "ref": "1"})
    assert response.status_code == 400


async def test_leagues_list_says_where_each_league_came_from(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    admin = await _user(pool, admin=True)
    leagues = (await _request("GET", "/admin/leagues", cookies=_cookie(admin))).json()["leagues"]
    assert all(row["source"] in {"espn", "sleeper", "app"} and "active_members" in row for row in leagues)
