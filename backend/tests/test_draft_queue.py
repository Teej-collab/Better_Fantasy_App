"""Tests for app/queries/draft_queue.py — the server-authoritative
draft queue/wishlist (2026-09). Real owners/leagues, real DB rows —
this module's whole job is transactional correctness (no duplicate/
missing ranks, no cross-owner leakage), not provider-shaped data."""
import itertools

from app.queries import draft_queue as draft_queue_queries
from tests.conftest import TEST_SEASON

_espn_member_id_counter = itertools.count(1)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-draftqueue-owner-{suffix}-{next(_espn_member_id_counter)}", f"Owner {suffix}",
        )


async def test_add_appends_to_the_end_in_order(pool):
    owner_id = await _seed_owner(pool, "append")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p2")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p3")
        queue = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_id)
    assert queue == ["p1", "p2", "p3"]


async def test_add_is_idempotent_for_an_already_queued_player(pool):
    owner_id = await _seed_owner(pool, "idempotent")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p1")  # no-op, not an error
        queue = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_id)
    assert queue == ["p1"]


async def test_remove_takes_a_player_out_without_disturbing_the_rest(pool):
    owner_id = await _seed_owner(pool, "remove")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p2")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p3")
        await draft_queue_queries.remove_from_queue(conn, TEST_SEASON, owner_id, "p2")
        queue = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_id)
    assert queue == ["p1", "p3"]


async def test_reorder_moves_last_player_to_first_with_no_duplicate_or_missing_ranks(pool):
    owner_id = await _seed_owner(pool, "reorder")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p2")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p3")
        result = await draft_queue_queries.reorder_queue(conn, TEST_SEASON, owner_id, ["p3", "p1", "p2"])
        queue = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_id)
        ranks = await conn.fetch(
            "SELECT rank FROM draft_queue_items WHERE season = $1 AND owner_id = $2 ORDER BY rank",
            TEST_SEASON, owner_id,
        )
    assert result == ["p3", "p1", "p2"]
    assert queue == ["p3", "p1", "p2"]
    assert [r["rank"] for r in ranks] == [1, 2, 3]  # no duplicates, no gaps


async def test_reorder_silently_drops_a_player_no_longer_in_the_queue(pool):
    """A real race: the client reorders a queue that includes a player
    who was drafted (and so queue-removed) a moment earlier. The
    request must not fail — it should just reorder what's actually
    still there."""
    owner_id = await _seed_owner(pool, "reorder_race")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_id, "p2")
        await draft_queue_queries.remove_player_from_all_queues(conn, TEST_SEASON, "p1")
        result = await draft_queue_queries.reorder_queue(conn, TEST_SEASON, owner_id, ["p1", "p2"])
    assert result == ["p2"]


async def test_reorder_ignores_a_different_owners_queue(pool):
    owner_a = await _seed_owner(pool, "reorder_iso_a")
    owner_b = await _seed_owner(pool, "reorder_iso_b")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_a, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_b, "p1")
        await draft_queue_queries.reorder_queue(conn, TEST_SEASON, owner_a, ["p1"])
        queue_b = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_b)
    assert queue_b == ["p1"]  # owner_b's own queue/rank untouched by owner_a's reorder


async def test_remove_player_from_all_queues_clears_every_owners_queue(pool):
    owner_a = await _seed_owner(pool, "wholedraft_a")
    owner_b = await _seed_owner(pool, "wholedraft_b")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_a, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_a, "p2")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_b, "p1")
        await draft_queue_queries.remove_player_from_all_queues(conn, TEST_SEASON, "p1")
        queue_a = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_a)
        queue_b = await draft_queue_queries.get_queue(conn, TEST_SEASON, owner_b)
    assert queue_a == ["p2"]
    assert queue_b == []


async def test_get_queue_owner_ids_for_player_finds_everyone_with_it_queued(pool):
    owner_a = await _seed_owner(pool, "ownerids_a")
    owner_b = await _seed_owner(pool, "ownerids_b")
    owner_c = await _seed_owner(pool, "ownerids_c")
    async with pool.acquire() as conn:
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_a, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_b, "p1")
        await draft_queue_queries.add_to_queue(conn, TEST_SEASON, owner_c, "p2")
        owner_ids = await draft_queue_queries.get_queue_owner_ids_for_player(conn, TEST_SEASON, "p1")
    assert set(owner_ids) == {owner_a, owner_b}
