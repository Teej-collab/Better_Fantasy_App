"""Unit coverage for app/auth/league_context.py — the session-resolved
active-league gate every personal-data router (me.py, draft.py,
chug.py, keepers.py, admin*.py) now depends on. See TODO.md's PHASE 9
entry.
"""
import pytest
from fastapi import HTTPException

from app.auth.league_context import (
    require_active_league_id,
    require_commissioner_of,
    require_league_commissioner,
    resolve_active_league_id,
)
from app.config import DEFAULT_LEAGUE_ID
from app.queries import leagues as league_queries

TEST_SEASON = 1900  # matches conftest.TEST_SEASON


async def _make_user(conn, suffix: str) -> int:
    return await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-leaguecontext-{suffix}@example.com", f"Test User {suffix}",
    )


async def test_resolve_active_league_id_falls_back_to_default_for_signed_out(pool):
    async with pool.acquire() as conn:
        result = await resolve_active_league_id(conn, None)
    assert result == DEFAULT_LEAGUE_ID


async def test_resolve_active_league_id_falls_back_to_default_when_none_set(pool):
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "resolve-none")
        result = await resolve_active_league_id(conn, {"user_id": user_id})
    assert result == DEFAULT_LEAGUE_ID


async def test_resolve_active_league_id_returns_the_real_active_league(pool):
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "resolve-real")
        league_id = await league_queries.create_league(conn, "Test League Resolve", user_id, "resolve-code")
        await league_queries.set_active_league_id(conn, user_id, league_id)
        result = await resolve_active_league_id(conn, {"user_id": user_id})
    assert result == league_id


async def test_require_active_league_id_raises_409_when_none_set(pool):
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "require-none")
        with pytest.raises(HTTPException) as exc_info:
            await require_active_league_id(conn, {"user_id": user_id})
    assert exc_info.value.status_code == 409


async def test_require_active_league_id_returns_it_when_set(pool):
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "require-set")
        league_id = await league_queries.create_league(conn, "Test League Require", user_id, "require-code")
        await league_queries.set_active_league_id(conn, user_id, league_id)
        result = await require_active_league_id(conn, {"user_id": user_id})
    assert result == league_id


async def test_require_commissioner_of_raises_403_for_a_non_member(pool):
    async with pool.acquire() as conn:
        owner_user_id = await _make_user(conn, "commish-owner")
        outsider_user_id = await _make_user(conn, "commish-outsider")
        league_id = await league_queries.create_league(conn, "Test League Commish A", owner_user_id, "commish-a-code")
        await league_queries.add_member(conn, league_id, owner_user_id, "commissioner")

        with pytest.raises(HTTPException) as exc_info:
            await require_commissioner_of(conn, {"user_id": outsider_user_id}, league_id)
    assert exc_info.value.status_code == 403


async def test_require_commissioner_of_raises_403_for_a_member_who_isnt_commissioner(pool):
    async with pool.acquire() as conn:
        owner_user_id = await _make_user(conn, "commish-owner2")
        member_user_id = await _make_user(conn, "commish-member")
        league_id = await league_queries.create_league(conn, "Test League Commish B", owner_user_id, "commish-b-code")
        await league_queries.add_member(conn, league_id, owner_user_id, "commissioner")
        await league_queries.add_member(conn, league_id, member_user_id, "member")

        with pytest.raises(HTTPException) as exc_info:
            await require_commissioner_of(conn, {"user_id": member_user_id}, league_id)
    assert exc_info.value.status_code == 403


async def test_require_commissioner_of_passes_for_the_real_commissioner(pool):
    async with pool.acquire() as conn:
        owner_user_id = await _make_user(conn, "commish-owner3")
        league_id = await league_queries.create_league(conn, "Test League Commish C", owner_user_id, "commish-c-code")
        await league_queries.add_member(conn, league_id, owner_user_id, "commissioner")

        # Doesn't raise.
        await require_commissioner_of(conn, {"user_id": owner_user_id}, league_id)


async def test_require_league_commissioner_returns_the_resolved_league_id(pool):
    async with pool.acquire() as conn:
        owner_user_id = await _make_user(conn, "commish-owner4")
        league_id = await league_queries.create_league(conn, "Test League Commish D", owner_user_id, "commish-d-code")
        await league_queries.add_member(conn, league_id, owner_user_id, "commissioner")

        result = await require_league_commissioner(conn, {"user_id": owner_user_id})
    assert result == league_id
