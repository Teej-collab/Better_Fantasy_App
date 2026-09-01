import os

import pytest
import pytest_asyncio

# Forces app/gamecast/providers/__init__.py's factory to the deterministic,
# no-network mock provider (fixed game ids "mock-kc-buf"/"mock-sf-dal",
# always in-progress) for the whole test run — set before any test module
# imports app.main / touches the gamecast router, since the factory caches
# whichever provider it picks as a singleton on first use. Without this,
# tests would hit the real ESPNNFLDataProvider (the default outside tests
# now — see that module's docstring) against a real network, which is both
# slow/flaky in CI and would 404 immediately since "mock-kc-buf" isn't a
# real ESPN event id.
os.environ.setdefault("GAMECAST_PROVIDER", "mock")

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
        await conn.execute("DELETE FROM team_bye_weeks WHERE season = $1", TEST_SEASON)
        # TEST_SEASON - 1 too, not just TEST_SEASON: keeper tests
        # (test_keepers.py) seed a "prior season" roster to pick keepers
        # from, the first tests in this suite to need that concept.
        await conn.execute("DELETE FROM rosters WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        # Also TEST_SEASON - 1: get_playoff_team_count (queries/league.py)
        # looks at the most recent PRIOR season's real is_playoff
        # matchups, so its own test seeds one — must go before the
        # teams_by_season DELETE below (matchups.home/away_team_id ->
        # teams_by_season.id) or that FK-violates for TEST_SEASON - 1
        # rows the same way this file already guards against elsewhere.
        await conn.execute("DELETE FROM matchups WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
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
        # current_rosters/draft_picks reference teams_by_season(id), so
        # they have to go before the teams_by_season DELETE below.
        await conn.execute("DELETE FROM current_rosters WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        await conn.execute("DELETE FROM draft_picks WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        await conn.execute("DELETE FROM draft_config WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        await conn.execute("DELETE FROM player_week_stats WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        await conn.execute("DELETE FROM league_scoring_rules WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        await conn.execute("DELETE FROM teams_by_season WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        # keeper_selections.owner_id -> owners.owner_id, so it goes before
        # the owner DELETE below like rivalries/owner_preferences above —
        # by owner (test-% pattern) rather than by season since a keeper
        # test may write rows for TEST_SEASON *and* TEST_SEASON - 1 (last
        # year's picks, for carryover tests). league_keeper_rules has no
        # owner_id column, so that one's still scoped by season directly.
        await conn.execute(
            "DELETE FROM keeper_selections WHERE owner_id IN (SELECT owner_id FROM owners WHERE espn_member_id LIKE 'test-%')"
        )
        await conn.execute("DELETE FROM league_keeper_rules WHERE season = ANY($1::int[])", [TEST_SEASON, TEST_SEASON - 1])
        # Leagues a test created directly via POST /leagues, and
        # everything that references leagues.id, cleaned up FIRST and
        # entirely before any owners/users deletion below — a test
        # league's own creator (leagues.created_by_user_id -> users.id)
        # is very often also one of the owners.user_id-linked users
        # cleaned up next, and deleting that user before its league is
        # gone is a real FK violation, not a hypothetical one (caught
        # directly: test_draft_router.py's commissioner-seeding helper
        # creates exactly this shape — one user who both owns a team
        # and created the league). Tests are expected to name any
        # league they create "Test League ..." for this whole block to
        # find it.
        #
        # league_scoring_rules.league_id -> leagues.id — POST /leagues
        # (app/routers/leagues.py) seeds default scoring rules for the
        # real ACTIVE_SEASON (2026), not TEST_SEASON, so the
        # season-scoped league_scoring_rules cleanup above never
        # catches these.
        await conn.execute(
            "DELETE FROM league_scoring_rules WHERE league_id IN (SELECT id FROM leagues WHERE name LIKE 'Test League%')"
        )
        await conn.execute(
            "DELETE FROM league_members WHERE league_id IN (SELECT id FROM leagues WHERE name LIKE 'Test League%')"
        )
        # users.active_league_id -> leagues.id (migration 119d4af5c920) —
        # a user who joined a test league via POST /leagues/{id}/select
        # (or was auto-activated into one, see app/queries/leagues.py's
        # add_member) still points at it here regardless of whether
        # they're one of the 'test-%'-pattern owners/users cleaned up
        # below. Must be cleared before the leagues DELETE below or it
        # FK-violates — same shape of bug this file already guards
        # against for league_members/league_scoring_rules just above.
        await conn.execute(
            "UPDATE users SET active_league_id = NULL WHERE active_league_id IN "
            "(SELECT id FROM leagues WHERE name LIKE 'Test League%')"
        )
        await conn.execute("DELETE FROM leagues WHERE name LIKE 'Test League%'")
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
            # league_members.user_id -> users.id (Phase 2 of the multi-
            # league migration auto-enrolls every login into the default
            # league — see app/queries/auth.py) — must go before the
            # users DELETE below or it FK-violates. The leagues cleanup
            # above already removed any test-league membership; this
            # catches auto-enrollment into the real default league.
            await conn.execute("DELETE FROM league_members WHERE user_id = ANY($1::int[])", linked_user_ids)
            await conn.execute("DELETE FROM users WHERE id = ANY($1::int[])", linked_user_ids)
        # Teams a test created directly via POST /leagues/{id}/teams. An
        # owner created for a password-signup test user via
        # get_or_create_owner_for_user has no espn_member_id at all
        # (unlike a Discord test owner), so it's invisible to the
        # 'test-%' pattern above — found instead via its linked test
        # user's email. Must run after the teams_by_season cleanup
        # above (which already removed any TEST_SEASON team, so nothing
        # still references these owners) and before the users DELETE
        # below (owners.user_id -> users.id).
        test_signup_owner_ids = [
            r["owner_id"]
            for r in await conn.fetch(
                "SELECT o.owner_id FROM owners o JOIN users u ON u.id = o.user_id WHERE u.email LIKE 'test-%'"
            )
        ]
        if test_signup_owner_ids:
            await conn.execute("DELETE FROM owners WHERE owner_id = ANY($1::int[])", test_signup_owner_ids)
        # league_members.user_id -> users.id, no ON DELETE CASCADE
        # (migration d7deccb620bb) — a test user can join real
        # DEFAULT_LEAGUE_ID membership directly (bypassing owners
        # entirely, e.g. to exercise a real per-league commissioner
        # check) without ever getting an owners row, so this can't rely
        # on the owners.user_id-derived linked_user_ids cleanup above.
        # Must run before the users DELETE below or it FK-violates.
        await conn.execute(
            "DELETE FROM league_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test-%')"
        )
        # Phase 5 password-signup test users have no owners row at all
        # (see app/queries/auth.py's create_user_with_password) — not
        # covered by the owner-linked cleanup above, so cleaned up
        # separately by email convention.
        await conn.execute("DELETE FROM users WHERE email LIKE 'test-%'")
        # players has no season/owner column (it's a global Sleeper-sourced
        # reference table, not per-season) — test rows use a 'test-%'
        # sleeper_player_id prefix, same convention as owners.espn_member_id.
        await conn.execute("DELETE FROM players WHERE sleeper_player_id LIKE 'test-%'")


@pytest.fixture
def espn_config(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    return ESPNConfig()
