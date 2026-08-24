import pytest
import pytest_asyncio

from app import db as db_module
from app.db import get_pool
from app.providers.espn.config import ESPNConfig

# Pools stashed here by tests/test_chat.py and tests/test_gamecast_router.py's
# _use_fresh_pool_for_websocket() helper, to be closed on the NEXT test's
# setup rather than immediately. Those helpers reset db_module._pool mid-test
# (WebSocket tests run the ASGI app on its own event loop via starlette's
# TestClient, so the pool has to be recreated on that loop) — but the pool
# being discarded is still the exact object this same test's own `pool`
# fixture and cleanup_test_season teardown (below) are holding a reference
# to and will still use before the test finishes. Closing it immediately
# breaks that teardown ("pool is closed"); leaking it forever exhausts
# Postgres's max_connections a couple dozen WebSocket tests into a full
# suite run (TooManyConnectionsError). Closing it here, at the start of the
# NEXT test — after the test that stashed it, and all of that test's own
# fixture teardown, have fully finished — is the one point in time where
# it's both safe and prompt.
_pending_pool_close: list = []

# MUST be a season number that can never be a real league season, ever.
# cleanup_test_season below runs after every single test and does an
# unscoped `DELETE FROM <table> WHERE season = TEST_SEASON` — the app's
# default DATABASE_URL is production (the same DB the live league uses,
# see DEVELOPMENT.md), so if this ever collides with a real season, that
# season's real data gets silently wiped the moment any test runs.
# This happened for real: TEST_SEASON was 2024, the league's real 2024
# season had no data yet at the time, so the collision was invisible —
# until 2024 was backfilled with real data and the very next test run
# deleted all of it. A year like 1900 can't ever collide, by
# construction — don't "fix" this back to a real-looking year.
TEST_SEASON = 1900


@pytest_asyncio.fixture
async def _close_pool_stashed_by_a_websocket_test():
    if _pending_pool_close:
        old_pool = _pending_pool_close.pop()
        try:
            await old_pool.close()
        except Exception:
            pass


@pytest_asyncio.fixture
async def pool(_close_pool_stashed_by_a_websocket_test):
    return await get_pool()


@pytest_asyncio.fixture(autouse=True)
async def cleanup_test_season(pool):
    yield
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM league_state WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM rosters WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM matchups WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM bench_crimes WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM weekly_team_stats WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM final_standings WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM season_champions WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM season_awards WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM chug_debts WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM chug_scores WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM chug_deadline_settlements WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM chug_debt_accruals WHERE season = $1", TEST_SEASON)
        await conn.execute("DELETE FROM chug_standing WHERE season = $1", TEST_SEASON)
        # rivalries.owner_a_id/owner_b_id and messages.owner_id -> owners.owner_id,
        # so both have to go before deleting owners below (neither has a season
        # column to scope by — every test owner is 'test-%', so that's the only
        # signal here). Individual chat tests already clean up their own rows,
        # but this is the backstop if a test fails before it gets there.
        await conn.execute(
            "DELETE FROM rivalries WHERE owner_a_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%') "
            "OR owner_b_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        # owner_preferences.owner_id -> owners.owner_id, one row per owner,
        # no season column to scope by (same reasoning as rivalries above).
        await conn.execute(
            "DELETE FROM owner_preferences WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        # push_subscriptions.owner_id -> owners.owner_id, same reasoning —
        # no season column, one/many rows per owner, must go before the
        # owner DELETE below or it FK-violates.
        await conn.execute(
            "DELETE FROM push_subscriptions WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        # Chat v2: reactions/mentions reference messages, so they go first;
        # conversation_participants references conversations, so it goes
        # before the orphaned-direct-conversation cleanup. Tests never touch
        # the real seeded league conversation (only ever create their own
        # fresh conversations with test owners), so this can't ever delete
        # real chat data — only conversations a test itself created.
        await conn.execute(
            "DELETE FROM message_reactions WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        await conn.execute(
            "DELETE FROM message_mentions WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        await conn.execute(
            "DELETE FROM messages WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        await conn.execute(
            "DELETE FROM conversation_participants WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        await conn.execute(
            "DELETE FROM conversations WHERE type = 'direct' "
            "AND id NOT IN (SELECT conversation_id FROM conversation_participants)"
        )
        await conn.execute("DELETE FROM teams_by_season WHERE season = $1", TEST_SEASON)
        # owners.user_id -> users.id, so capture which users are linked to
        # test owners *before* deleting those owners, then delete the
        # users afterward — deleting users first would violate the FK.
        linked_user_ids = [
            r["user_id"]
            for r in await conn.fetch(
                "SELECT user_id FROM owners WHERE espn_member_id LIKE 'test-%' AND user_id IS NOT NULL"
            )
        ]
        await conn.execute("DELETE FROM owners WHERE espn_member_id LIKE 'test-%'")
        if linked_user_ids:
            await conn.execute("DELETE FROM users WHERE id = ANY($1::int[])", linked_user_ids)


@pytest.fixture
def espn_config(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    return ESPNConfig()
