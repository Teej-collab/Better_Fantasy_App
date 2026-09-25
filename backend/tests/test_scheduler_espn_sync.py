"""
Covers the multi-league piece of Phase 6 (see TODO.md's PHASE 9 entry):
_run_full_sync_job/_run_live_sync_job syncing every league with its own
saved ESPN connection, not just League #1. run_full_sync/run_live_sync
themselves are already covered by test_sync_orchestration.py — these
tests monkeypatch them directly to isolate the orchestration logic
added here (the loop, per-league failure isolation, success/failure
marking) from re-testing their own internals.
"""
from app.encryption import encrypt_secret
from app.queries import leagues as league_queries
from app.scheduler import _run_full_sync_job, _run_live_sync_job
from tests.conftest import TEST_SEASON


async def _make_league(conn, suffix: str) -> int:
    creator_user_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-scheduler-espn-{suffix}-creator@example.com", f"Creator {suffix}",
    )
    return await league_queries.create_league(
        conn, f"Test League Scheduler ESPN {suffix}", creator_user_id, f"scheduler-espn-{suffix}-code"
    )


async def _connect_espn(conn, league_id: int, espn_league_id: int):
    await conn.execute(
        """
        INSERT INTO league_espn_connections
            (league_id, espn_league_id, espn_s2_encrypted, espn_swid_encrypted, connected_by_user_id)
        VALUES ($1, $2, $3, $4, NULL)
        """,
        league_id, espn_league_id, encrypt_secret("fake-s2"), encrypt_secret("{fake-swid}"),
    )


async def test_full_sync_job_also_syncs_every_connected_league(pool, espn_config, monkeypatch):
    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "full-sync")
        await _connect_espn(conn, league_id, 555555)

    calls = []

    async def fake_run_full_sync(provider, start_season, end_season, league_id=1):
        calls.append({"espn_league_id": provider.config.league_id, "app_league_id": league_id, "season": end_season})
        return {end_season: {"teams": {"status": "success", "count": 1}}}

    monkeypatch.setattr("app.scheduler.run_full_sync", fake_run_full_sync)

    await _run_full_sync_job()

    # League #1's own env-var-driven call (no league_id kwarg — the
    # default) plus the connected league's own, each with its own real
    # ESPN league id.
    assert {"espn_league_id": espn_config.league_id, "app_league_id": 1, "season": TEST_SEASON} in calls
    assert {"espn_league_id": 555555, "app_league_id": league_id, "season": TEST_SEASON} in calls

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT last_synced_at, last_sync_error FROM league_espn_connections WHERE league_id = $1", league_id
        )
    assert row["last_synced_at"] is not None
    assert row["last_sync_error"] is None


async def test_full_sync_job_continues_after_one_connected_league_fails(pool, espn_config, monkeypatch):
    async with pool.acquire() as conn:
        broken_league_id = await _make_league(conn, "full-sync-broken")
        await _connect_espn(conn, broken_league_id, 111)
        healthy_league_id = await _make_league(conn, "full-sync-healthy")
        await _connect_espn(conn, healthy_league_id, 222)

    async def fake_run_full_sync(provider, start_season, end_season, league_id=1):
        if provider.config.league_id == 111:
            raise Exception("ESPN session expired")
        return {end_season: {"teams": {"status": "success", "count": 1}}}

    monkeypatch.setattr("app.scheduler.run_full_sync", fake_run_full_sync)

    await _run_full_sync_job()  # must not raise — one league's failure can't take down the rest

    async with pool.acquire() as conn:
        broken = await conn.fetchrow(
            "SELECT last_synced_at, last_sync_error FROM league_espn_connections WHERE league_id = $1",
            broken_league_id,
        )
        healthy = await conn.fetchrow(
            "SELECT last_synced_at, last_sync_error FROM league_espn_connections WHERE league_id = $1",
            healthy_league_id,
        )
    assert broken["last_sync_error"] == "ESPN session expired"
    assert broken["last_synced_at"] is None
    assert healthy["last_synced_at"] is not None
    assert healthy["last_sync_error"] is None


async def test_full_sync_job_marks_failure_when_the_teams_step_itself_fails(pool, espn_config, monkeypatch):
    """Distinct from the test above — run_full_sync doesn't raise here
    (its own per-step try/except swallows it, same as a real ESPN
    401), so this exercises the "teams step reports failed" branch,
    not the "the whole call raised" one."""
    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "full-sync-teams-failed")
        await _connect_espn(conn, league_id, 333)

    async def fake_run_full_sync(provider, start_season, end_season, league_id=1):
        if provider.config.league_id == 333:
            return {end_season: {"teams": {"status": "failed", "detail": "ESPN rejected this request (401)"}}}
        return {end_season: {"teams": {"status": "success", "count": 1}}}

    monkeypatch.setattr("app.scheduler.run_full_sync", fake_run_full_sync)

    await _run_full_sync_job()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT last_synced_at, last_sync_error FROM league_espn_connections WHERE league_id = $1", league_id
        )
    assert row["last_sync_error"] == "ESPN rejected this request (401)"
    assert row["last_synced_at"] is None


async def test_live_sync_job_also_syncs_every_connected_league_when_a_game_is_live(pool, espn_config, monkeypatch):
    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "live-sync")
        await _connect_espn(conn, league_id, 777)

    async def fake_get_nfl_scoreboard():
        return {}

    async def fake_get_real_current_week():
        return 3

    monkeypatch.setattr("app.scheduler.get_nfl_scoreboard", fake_get_nfl_scoreboard)
    monkeypatch.setattr("app.scheduler.is_nfl_game_live", lambda games: True)
    monkeypatch.setattr("app.scheduler.get_real_current_week", fake_get_real_current_week)

    async def fake_snapshot_week(conn, season, week):
        return {}

    async def fake_notify_fantasy_events(conn, season, before, after):
        return None

    monkeypatch.setattr("app.scheduler.fantasy_events.snapshot_week", fake_snapshot_week)
    monkeypatch.setattr("app.scheduler.fantasy_events.notify_fantasy_events", fake_notify_fantasy_events)

    calls = []

    async def fake_run_live_sync(provider, season, week, league_id=1):
        calls.append({"espn_league_id": provider.config.league_id, "app_league_id": league_id})
        return {"matchups": {"status": "success", "count": 1}}

    monkeypatch.setattr("app.scheduler.run_live_sync", fake_run_live_sync)

    await _run_live_sync_job()

    assert {"espn_league_id": espn_config.league_id, "app_league_id": 1} in calls
    assert {"espn_league_id": 777, "app_league_id": league_id} in calls

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT last_synced_at FROM league_espn_connections WHERE league_id = $1", league_id
        )
    assert row["last_synced_at"] is not None


async def test_live_sync_job_skips_every_league_when_no_game_is_live(pool, espn_config, monkeypatch):
    async with pool.acquire() as conn:
        league_id = await _make_league(conn, "live-sync-no-game")
        await _connect_espn(conn, league_id, 888)

    async def fake_get_nfl_scoreboard():
        return {}

    monkeypatch.setattr("app.scheduler.get_nfl_scoreboard", fake_get_nfl_scoreboard)
    monkeypatch.setattr("app.scheduler.is_nfl_game_live", lambda games: False)

    called = False

    async def fake_run_live_sync(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr("app.scheduler.run_live_sync", fake_run_live_sync)

    await _run_live_sync_job()
    assert called is False
