from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import leagues as league_queries
from app.config import DEFAULT_LEAGUE_ID

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int) -> dict:
    token = create_session_token(_SESSION_SECRET, user_id=user_id)
    return {"session": token}


async def _make_user(conn, suffix: str) -> int:
    return await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-league-members-{suffix}@example.com", f"Test Member {suffix}",
    )


async def _commissioner_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id)


async def _member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return user_id, _session_cookie(user_id)


async def _client(cookies=None):
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    if cookies:
        client.cookies.update(cookies)
    return client


def _decode_user_id(cookies: dict) -> int:
    from app.auth.session import decode_session_token

    payload = decode_session_token(_SESSION_SECRET, cookies["session"])
    return payload["user_id"]


async def test_list_members_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with await _client() as client:
        response = await client.get(f"/leagues/{DEFAULT_LEAGUE_ID}/members")
    assert response.status_code == 401


async def test_set_role_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with await _client() as client:
        response = await client.patch(f"/leagues/{DEFAULT_LEAGUE_ID}/members/999999", json={"role": "commissioner"})
    assert response.status_code == 401


async def test_commissioner_can_list_members_with_resolved_names(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commissioner_cookies = await _commissioner_cookies(pool, "list-comm")
    member_id, _ = await _member_cookies(pool, "list-member")

    async with await _client(commissioner_cookies) as client:
        response = await client.get(f"/leagues/{DEFAULT_LEAGUE_ID}/members")

    assert response.status_code == 200
    members = response.json()["members"]
    member_ids = {m["user_id"] for m in members}
    assert member_id in member_ids
    listed = next(m for m in members if m["user_id"] == member_id)
    assert listed["role"] == "member"
    assert listed["display_name"] == "Test Member list-member"


async def test_commissioner_can_promote_a_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commissioner_cookies = await _commissioner_cookies(pool, "promote-comm")
    member_id, _ = await _member_cookies(pool, "promote-member")

    async with await _client(commissioner_cookies) as client:
        response = await client.patch(
            f"/leagues/{DEFAULT_LEAGUE_ID}/members/{member_id}", json={"role": "commissioner"}
        )
    assert response.status_code == 200
    assert response.json() == {"user_id": member_id, "role": "commissioner"}

    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, DEFAULT_LEAGUE_ID, member_id)
    assert membership["role"] == "commissioner"


async def test_commissioner_can_demote_another_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commissioner_cookies = await _commissioner_cookies(pool, "demote-comm")
    other_commissioner_cookies = await _commissioner_cookies(pool, "demote-target")
    target_id = _decode_user_id(other_commissioner_cookies)

    async with await _client(commissioner_cookies) as client:
        response = await client.patch(
            f"/leagues/{DEFAULT_LEAGUE_ID}/members/{target_id}", json={"role": "member"}
        )
    assert response.status_code == 200

    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, DEFAULT_LEAGUE_ID, target_id)
    assert membership["role"] == "member"


async def test_commissioner_cannot_change_own_role(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commissioner_cookies = await _commissioner_cookies(pool, "self-block")
    own_id = _decode_user_id(commissioner_cookies)

    async with await _client(commissioner_cookies) as client:
        response = await client.patch(
            f"/leagues/{DEFAULT_LEAGUE_ID}/members/{own_id}", json={"role": "member"}
        )
    assert response.status_code == 400


async def test_non_commissioner_cannot_promote_anyone(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    _, member_cookies = await _member_cookies(pool, "reject-actor")
    other_member_id, _ = await _member_cookies(pool, "reject-target")

    async with await _client(member_cookies) as client:
        response = await client.patch(
            f"/leagues/{DEFAULT_LEAGUE_ID}/members/{other_member_id}", json={"role": "commissioner"}
        )
    assert response.status_code == 403


async def test_promoting_a_non_member_returns_404(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    commissioner_cookies = await _commissioner_cookies(pool, "404-comm")
    async with pool.acquire() as conn:
        non_member_id = await _make_user(conn, "404-nonmember")

    async with await _client(commissioner_cookies) as client:
        response = await client.patch(
            f"/leagues/{DEFAULT_LEAGUE_ID}/members/{non_member_id}", json={"role": "commissioner"}
        )
    assert response.status_code == 404
