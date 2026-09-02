import datetime

from app.queries import leagues as league_queries
from app.scheduler import _run_keeper_lock_job
from tests.conftest import TEST_SEASON


async def _make_league(conn, suffix: str) -> int:
    creator_user_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-scheduler-{suffix}-creator@example.com", f"Creator {suffix}",
    )
    return await league_queries.create_league(
        conn, f"Test League Scheduler {suffix}", creator_user_id, f"scheduler-{suffix}-code"
    )


async def _seed_draft_config(conn, league_id: int, scheduled_start):
    await conn.execute(
        "INSERT INTO draft_config (season, draft_order, roster_slots, league_id, scheduled_start) "
        "VALUES ($1, $2, $3, $4, $5)",
        TEST_SEASON, [1], "{}", league_id, scheduled_start,
    )


async def _seed_keeper_rules(conn, league_id: int, max_keepers: int = 2):
    await conn.execute(
        "INSERT INTO league_keeper_rules (season, max_keepers, league_id) VALUES ($1, $2, $3)",
        TEST_SEASON, max_keepers, league_id,
    )


async def test_keeper_lock_job_locks_a_league_within_one_hour_of_draft(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "due")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(minutes=30))
        await _seed_keeper_rules(conn, league_id)

        await _run_keeper_lock_job()

        row = await conn.fetchrow(
            "SELECT locked_at FROM league_keeper_rules WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert row["locked_at"] is not None


async def test_keeper_lock_job_leaves_a_league_more_than_one_hour_out_untouched(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "not-due")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(hours=5))
        await _seed_keeper_rules(conn, league_id)

        await _run_keeper_lock_job()

        row = await conn.fetchrow(
            "SELECT locked_at FROM league_keeper_rules WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert row["locked_at"] is None


async def test_keeper_lock_job_ignores_a_league_with_no_keepers(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "no-keepers")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(minutes=10))
        await _seed_keeper_rules(conn, league_id, max_keepers=0)

        await _run_keeper_lock_job()

        row = await conn.fetchrow(
            "SELECT locked_at FROM league_keeper_rules WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert row["locked_at"] is None


async def test_keeper_lock_job_is_idempotent_on_an_already_locked_league(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "already-locked")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(minutes=5))
        await _seed_keeper_rules(conn, league_id)

        await _run_keeper_lock_job()
        first = await conn.fetchval(
            "SELECT locked_at FROM league_keeper_rules WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
        await _run_keeper_lock_job()
        second = await conn.fetchval(
            "SELECT locked_at FROM league_keeper_rules WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )

    assert first == second  # second run is a no-op, doesn't bump locked_at
