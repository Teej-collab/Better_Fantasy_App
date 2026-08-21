from datetime import datetime
from zoneinfo import ZoneInfo

from app.domain.chug_standing import (
    accrue_weekly_debt,
    clear_fine,
    ensure_chug_deadline_settled,
    record_completed_chug,
    settle_deadline_for_week,
)
from tests.conftest import TEST_SEASON

ET = ZoneInfo("America/New_York")
# A real Monday (2026-08-24) with no game landing on it -> the fallback
# 8:15 PM ET kickoff slot from app/domain/chug_deadline.py applies.
_GAMES = [{"name": "irrelevant", "date": "2026-08-21T00:00Z"}]  # Thursday, not the Monday
_BEFORE_DEADLINE = datetime(2026, 8, 24, 19, 0, tzinfo=ET)
_AFTER_DEADLINE = datetime(2026, 8, 24, 23, 0, tzinfo=ET)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-chugstanding-owner-{suffix}", f"Owner {suffix}",
        )


async def _standing(pool, owner_id):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT outstanding_owed, fined_owed, consecutive_missed_weeks FROM chug_standing "
            "WHERE season = $1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )
    return dict(row) if row else None


async def test_accrue_weekly_debt_creates_standing_row(pool):
    owner_id = await _seed_owner(pool, 1)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 3)",
            TEST_SEASON, owner_id,
        )
        await accrue_weekly_debt(conn, TEST_SEASON, 1)

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 3


async def test_accrue_weekly_debt_is_idempotent(pool):
    owner_id = await _seed_owner(pool, 2)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)",
            TEST_SEASON, owner_id,
        )
        await accrue_weekly_debt(conn, TEST_SEASON, 1)
        await accrue_weekly_debt(conn, TEST_SEASON, 1)  # re-run, e.g. next sync tick
        await accrue_weekly_debt(conn, TEST_SEASON, 1)

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 2  # not 6


async def test_accrue_weekly_debt_applies_only_the_delta_on_correction(pool):
    owner_id = await _seed_owner(pool, 3)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)",
            TEST_SEASON, owner_id,
        )
        await accrue_weekly_debt(conn, TEST_SEASON, 1)

        # A stat correction raises this week's real owed total.
        await conn.execute(
            "UPDATE chug_debts SET chugs_owed = 5 WHERE season = $1 AND week = 1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )
        await accrue_weekly_debt(conn, TEST_SEASON, 1)

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 5  # 2 + delta of 3, not 2 + 5


async def test_settle_deadline_no_debt_resets_streak(pool):
    owner_id = await _seed_owner(pool, 4)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed, consecutive_missed_weeks) "
            "VALUES ($1, $2, 0, 2)",
            TEST_SEASON, owner_id,
        )
        settled = await settle_deadline_for_week(conn, TEST_SEASON, 1)
        action = await conn.fetchval(
            "SELECT action FROM chug_deadline_settlements WHERE season = $1 AND week = 1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )

    assert settled == 1
    assert action == "no_debt"
    standing = await _standing(pool, owner_id)
    assert standing["consecutive_missed_weeks"] == 0


async def test_settle_deadline_doubles_outstanding_owed(pool):
    owner_id = await _seed_owner(pool, 5)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 3)",
            TEST_SEASON, owner_id,
        )
        await settle_deadline_for_week(conn, TEST_SEASON, 1)

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 6
    assert standing["consecutive_missed_weeks"] == 1


async def test_settle_deadline_is_idempotent_per_week(pool):
    owner_id = await _seed_owner(pool, 6)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 2)",
            TEST_SEASON, owner_id,
        )
        first = await settle_deadline_for_week(conn, TEST_SEASON, 1)
        second = await settle_deadline_for_week(conn, TEST_SEASON, 1)  # same week again

    assert first == 1
    assert second == 0  # already settled, no-op
    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 4  # doubled once, not twice


async def test_settle_deadline_third_consecutive_miss_converts_to_fine(pool):
    owner_id = await _seed_owner(pool, 7)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed, consecutive_missed_weeks) "
            "VALUES ($1, $2, 4, 2)",
            TEST_SEASON, owner_id,
        )
        await settle_deadline_for_week(conn, TEST_SEASON, 1)
        action = await conn.fetchval(
            "SELECT action FROM chug_deadline_settlements WHERE season = $1 AND week = 1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )

    assert action == "fined"
    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 0
    assert standing["fined_owed"] == 4
    assert standing["consecutive_missed_weeks"] == 0  # fresh start after conversion


async def test_record_completed_chug_pays_down_real_debt(pool):
    owner_id = await _seed_owner(pool, 8)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 2)",
            TEST_SEASON, owner_id,
        )
        await record_completed_chug(conn, TEST_SEASON, owner_id)

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 1


async def test_record_completed_chug_never_goes_negative_or_touches_fined(pool):
    owner_id = await _seed_owner(pool, 9)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed, fined_owed) VALUES ($1, $2, 0, 5)",
            TEST_SEASON, owner_id,
        )
        # "For funsies" — nothing owed, so this should be a complete no-op
        # on the standing row (it still counts toward lifetime elsewhere).
        await record_completed_chug(conn, TEST_SEASON, owner_id)

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 0
    assert standing["fined_owed"] == 5  # untouched — only a commissioner can clear this


async def test_clear_fine_reduces_fined_owed(pool):
    owner_id = await _seed_owner(pool, 10)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, fined_owed) VALUES ($1, $2, 3)",
            TEST_SEASON, owner_id,
        )
        cleared = await clear_fine(conn, TEST_SEASON, owner_id, amount=2)

    assert cleared == 2
    standing = await _standing(pool, owner_id)
    assert standing["fined_owed"] == 1


async def test_clear_fine_with_no_amount_clears_everything(pool):
    owner_id = await _seed_owner(pool, 11)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, fined_owed) VALUES ($1, $2, 4)",
            TEST_SEASON, owner_id,
        )
        cleared = await clear_fine(conn, TEST_SEASON, owner_id, amount=None)

    assert cleared == 4
    standing = await _standing(pool, owner_id)
    assert standing["fined_owed"] == 0


async def test_ensure_chug_deadline_settled_noop_before_deadline(pool):
    owner_id = await _seed_owner(pool, 12)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)",
            TEST_SEASON, owner_id,
        )
    settled = await ensure_chug_deadline_settled(pool, TEST_SEASON, 1, _GAMES, now=_BEFORE_DEADLINE)
    assert settled == 0
    assert await _standing(pool, owner_id) is None  # not even accrued yet


async def test_ensure_chug_deadline_settled_accrues_and_settles_once_past_deadline(pool):
    owner_id = await _seed_owner(pool, 13)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)",
            TEST_SEASON, owner_id,
        )
    settled = await ensure_chug_deadline_settled(pool, TEST_SEASON, 1, _GAMES, now=_AFTER_DEADLINE)
    assert settled == 1

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 4  # 2 accrued, then doubled
