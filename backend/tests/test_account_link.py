"""Moving a new login onto someone's original account (app/domain/account_link.py,
POST /auth/link/confirm)."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.auth.session import create_session_token
from app.domain.account_link import AccountLinkError, link_login_into
from tests.test_chat import _SESSION_SECRET, _client


async def _user(conn, **cols):
    cols.setdefault("display_name", "Linker")
    keys = list(cols)
    return await conn.fetchval(
        f"INSERT INTO users ({', '.join(keys)}) VALUES ({', '.join(f'${i + 1}' for i in range(len(keys)))}) RETURNING id",
        *cols.values(),
    )


async def _cleanup(conn, *ids):
    await conn.execute("DELETE FROM league_members WHERE user_id = ANY($1::int[])", list(ids))
    await conn.execute("DELETE FROM owner_users WHERE user_id = ANY($1::int[])", list(ids))
    await conn.execute("DELETE FROM users WHERE id = ANY($1::int[])", list(ids))


async def test_moves_apple_login_onto_the_original_account(pool):
    apple = f"test-apple-{uuid.uuid4().hex}"
    async with pool.acquire() as conn:
        original = await _user(conn, discord_user_id=900000000 + int(uuid.uuid4().int % 99999))
        newer = await _user(conn, apple_user_id=apple, display_name="Nicholas")
        try:
            dry = await link_login_into(conn, newer, original, apply=False)
            assert dry["moved_identities"] == ["apple_user_id"]
            assert await conn.fetchval("SELECT 1 FROM users WHERE id = $1", newer)  # dry run changed nothing

            await link_login_into(conn, newer, original)
            assert await conn.fetchval("SELECT apple_user_id FROM users WHERE id = $1", original) == apple
            assert not await conn.fetchval("SELECT 1 FROM users WHERE id = $1", newer)
        finally:
            await _cleanup(conn, original, newer)


async def test_refuses_when_the_new_login_has_its_own_team(pool):
    async with pool.acquire() as conn:
        original = await _user(conn)
        newer = await _user(conn)
        owner = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, 'Someone') RETURNING owner_id",
            f"test-link-{uuid.uuid4().hex}",
        )
        await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner, newer)
        try:
            with pytest.raises(AccountLinkError):
                await link_login_into(conn, newer, original)
            assert await conn.fetchval("SELECT 1 FROM users WHERE id = $1", newer)
        finally:
            await _cleanup(conn, original, newer)


def _confirm_ticket(source, target):
    return jwt.encode(
        {"purpose": "link_confirm", "source_user_id": source, "target_user_id": target,
         "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        _SESSION_SECRET, algorithm="HS256",
    )


async def test_confirm_only_from_the_account_that_started_it(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    apple = f"test-apple-{uuid.uuid4().hex}"
    async with pool.acquire() as conn:
        original = await _user(conn)
        newer = await _user(conn, apple_user_id=apple)
        stranger = await _user(conn)
    try:
        ticket = _confirm_ticket(newer, original)
        async with _client() as client:
            wrong = await client.post(
                "/auth/link/confirm", json={"ticket": ticket},
                headers={"Authorization": f"Bearer {create_session_token(_SESSION_SECRET, user_id=stranger)}"},
            )
            right = await client.post(
                "/auth/link/confirm", json={"ticket": ticket},
                headers={"Authorization": f"Bearer {create_session_token(_SESSION_SECRET, user_id=newer)}"},
            )
        assert wrong.status_code == 403
        assert right.status_code == 200 and right.json()["token"]
        async with pool.acquire() as conn:
            assert await conn.fetchval("SELECT apple_user_id FROM users WHERE id = $1", original) == apple
    finally:
        async with pool.acquire() as conn:
            await _cleanup(conn, original, newer, stranger)
