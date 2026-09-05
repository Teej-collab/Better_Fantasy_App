"""Tests for app/queries/draft_room_chat.py — persisted draft-room chat
(2026-09). Real owners/messages, real DB rows, same "transactional
correctness, not provider-shaped data" scope as test_draft_queue.py."""
import itertools

from app.config import DEFAULT_LEAGUE_ID
from app.queries import draft_room_chat as draft_room_chat_queries
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_espn_member_id_counter = itertools.count(1)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-draftroomchat-owner-{suffix}-{next(_espn_member_id_counter)}", f"Owner {suffix}",
        )


async def _seed_league(pool, suffix):
    async with pool.acquire() as conn:
        creator_user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-draftroomchat-{suffix}-creator@example.com", f"Creator {suffix}",
        )
        return await league_queries.create_league(
            conn, f"Test League Draftroomchat {suffix}", creator_user_id, f"draftroomchat-{suffix}-code"
        )


async def test_insert_message_returns_the_row_with_owner_name(pool):
    owner_id = await _seed_owner(pool, "insert")
    async with pool.acquire() as conn:
        message = await draft_room_chat_queries.insert_message(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, owner_id, "hello room")
    assert message["text"] == "hello room"
    assert message["owner_id"] == owner_id
    assert message["owner_name"] == "Owner insert"
    assert message["id"] is not None
    assert message["created_at"] is not None


async def test_get_recent_messages_returns_oldest_first(pool):
    owner_id = await _seed_owner(pool, "order")
    async with pool.acquire() as conn:
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, owner_id, "first")
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, owner_id, "second")
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, owner_id, "third")
        messages = await draft_room_chat_queries.get_recent_messages(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
    texts = [m["text"] for m in messages if m["owner_id"] == owner_id]
    assert texts == ["first", "second", "third"]


async def test_get_recent_messages_respects_the_limit(pool):
    owner_id = await _seed_owner(pool, "limit")
    async with pool.acquire() as conn:
        for i in range(5):
            await draft_room_chat_queries.insert_message(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, owner_id, f"msg-{i}")
        messages = await draft_room_chat_queries.get_recent_messages(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, limit=2)
    own = [m for m in messages if m["owner_id"] == owner_id]
    # The 2 most recent, still returned oldest-first among themselves.
    assert [m["text"] for m in own] == ["msg-3", "msg-4"]


async def test_get_recent_messages_is_scoped_to_league(pool):
    owner_id = await _seed_owner(pool, "scoped")
    other_league_id = await _seed_league(pool, "scoped")
    async with pool.acquire() as conn:
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, owner_id, "in scope")
        await draft_room_chat_queries.insert_message(conn, TEST_SEASON, other_league_id, owner_id, "wrong league")
        messages = await draft_room_chat_queries.get_recent_messages(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
    texts = [m["text"] for m in messages if m["owner_id"] == owner_id]
    assert texts == ["in scope"]
