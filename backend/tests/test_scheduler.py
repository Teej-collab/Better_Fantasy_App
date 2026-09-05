import datetime
import itertools

from app.domain import draft_engine
from app.queries import leagues as league_queries
from app.scheduler import _run_draft_auto_start_job, _run_draft_starting_soon_job, _run_keeper_lock_job
from tests.conftest import TEST_SEASON

_espn_team_id_counter = itertools.count(800001)


async def _make_league(conn, suffix: str) -> int:
    creator_user_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-scheduler-{suffix}-creator@example.com", f"Creator {suffix}",
    )
    return await league_queries.create_league(
        conn, f"Test League Scheduler {suffix}", creator_user_id, f"scheduler-{suffix}-code"
    )


async def _seed_owner_and_team(conn, league_id: int, suffix: str) -> int:
    owner_id = await conn.fetchval(
        "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        f"test-scheduler-owner-{suffix}", f"Owner {suffix}",
    )
    await conn.execute(
        "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
        "VALUES ($1, $2, $3, $4, $5)",
        TEST_SEASON, next(_espn_team_id_counter), owner_id, f"Team {suffix}", league_id,
    )
    return owner_id


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


async def test_draft_starting_soon_job_notifies_a_league_within_15_minutes(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "starting-soon-due")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(minutes=10))

        # No draft_picks seeded — the job's own owner lookup then finds
        # nobody to notify, which notify_draft_starting_soon treats as
        # a no-op before it ever reaches a real push provider. What
        # this test actually verifies is the idempotency flag itself.
        await _run_draft_starting_soon_job()

        row = await conn.fetchrow(
            "SELECT starting_soon_notified_at FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert row["starting_soon_notified_at"] is not None


async def test_draft_starting_soon_job_leaves_a_league_more_than_15_minutes_out_untouched(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "starting-soon-not-due")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(hours=2))

        await _run_draft_starting_soon_job()

        row = await conn.fetchrow(
            "SELECT starting_soon_notified_at FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert row["starting_soon_notified_at"] is None


async def test_draft_starting_soon_job_is_idempotent(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "starting-soon-idempotent")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(minutes=5))

        await _run_draft_starting_soon_job()
        first = await conn.fetchval(
            "SELECT starting_soon_notified_at FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
        await _run_draft_starting_soon_job()
        second = await conn.fetchval(
            "SELECT starting_soon_notified_at FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )

    assert first == second  # second run is a no-op, doesn't re-notify


async def test_draft_starting_soon_job_ignores_a_draft_already_in_progress(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "starting-soon-in-progress")
        await _seed_draft_config(conn, league_id, now + datetime.timedelta(minutes=5))
        await conn.execute(
            "UPDATE draft_config SET status = 'in_progress' WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )

        await _run_draft_starting_soon_job()

        row = await conn.fetchrow(
            "SELECT starting_soon_notified_at FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert row["starting_soon_notified_at"] is None


# ---- draft auto-start (2026-09, pre-draft room feature) --------------------


async def test_draft_auto_start_job_starts_a_due_draft(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "autostart-due")
        owner_id = await _seed_owner_and_team(conn, league_id, "autostart-due")
        await draft_engine.create_draft(
            conn, TEST_SEASON, [owner_id], {"QB": 1, "BE": 1}, league_id=league_id
        )
        await conn.execute(
            "UPDATE draft_config SET scheduled_start = $1 WHERE season = $2 AND league_id = $3",
            now - datetime.timedelta(seconds=5), TEST_SEASON, league_id,
        )

        await _run_draft_auto_start_job()

        config = await conn.fetchrow(
            "SELECT status, current_pick_number FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert config["status"] == "in_progress"
    assert config["current_pick_number"] == 1


async def test_draft_auto_start_job_leaves_a_future_draft_untouched(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "autostart-future")
        owner_id = await _seed_owner_and_team(conn, league_id, "autostart-future")
        await draft_engine.create_draft(
            conn, TEST_SEASON, [owner_id], {"QB": 1, "BE": 1}, league_id=league_id
        )
        await conn.execute(
            "UPDATE draft_config SET scheduled_start = $1 WHERE season = $2 AND league_id = $3",
            now + datetime.timedelta(minutes=30), TEST_SEASON, league_id,
        )

        await _run_draft_auto_start_job()

        config = await conn.fetchrow(
            "SELECT status FROM draft_config WHERE season = $1 AND league_id = $2", TEST_SEASON, league_id
        )
    assert config["status"] == "not_started"


async def test_draft_auto_start_job_never_rewinds_an_already_in_progress_draft(pool, monkeypatch):
    """The exact race this job's own guard exists for: a commissioner
    already manually started the draft and a real pick has been made,
    but scheduled_start has also already passed — the job must be a
    clean no-op, never rewind current_pick_number back to 1."""
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    now = datetime.datetime.now(datetime.timezone.utc)

    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "autostart-norewind")
        owner_a = await _seed_owner_and_team(conn, league_id, "autostart-norewind-a")
        owner_b = await _seed_owner_and_team(conn, league_id, "autostart-norewind-b")
        await draft_engine.create_draft(
            conn, TEST_SEASON, [owner_a, owner_b], {"QB": 1, "BE": 1}, league_id=league_id
        )
        await conn.execute(
            "UPDATE draft_config SET scheduled_start = $1 WHERE season = $2 AND league_id = $3",
            now - datetime.timedelta(seconds=5), TEST_SEASON, league_id,
        )
        await draft_engine.start_draft(conn, TEST_SEASON, league_id=league_id)
        player_id = await conn.fetchval(
            "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
            "VALUES ('test-scheduler-autostart-player', 'Test Player', 'QB', ARRAY['QB'], 'KC', 'Active', TRUE) "
            "RETURNING sleeper_player_id"
        )
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player_id, league_id=league_id)

        await _run_draft_auto_start_job()

        config = await conn.fetchrow(
            "SELECT status, current_pick_number FROM draft_config WHERE season = $1 AND league_id = $2",
            TEST_SEASON, league_id,
        )
    assert config["status"] == "in_progress"
    assert config["current_pick_number"] == 2  # not rewound back to 1
