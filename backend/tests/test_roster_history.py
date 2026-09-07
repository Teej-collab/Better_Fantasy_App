from app.queries.league import get_current_roster, get_roster_for_week
from app.queries.roster_history import get_latest_snapshotted_week, snapshot_week
from tests.conftest import TEST_SEASON


async def _seed_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-rosterhist-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 500 + suffix, owner_id, f"Team {suffix}",
        )
    return team_id


async def _add_player(conn, sleeper_id, name, team_id, slot, projected=10.0):
    await conn.execute(
        "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_avg_points) "
        "VALUES ($1, $2, 'RB', TRUE, $3)",
        sleeper_id, name, projected,
    )
    await conn.execute(
        "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
        "VALUES ($1, $2, $3, $4, 'draft')",
        TEST_SEASON, team_id, sleeper_id, slot,
    )


async def test_snapshot_week_freezes_current_rosters(pool):
    team_id = await _seed_team(pool, 1)

    async with pool.acquire() as conn:
        await _add_player(conn, "test-rh-p1", "Player One", team_id, "RB")
        inserted = await snapshot_week(conn, TEST_SEASON, 1)
        assert inserted == 1

        rows = await conn.fetch(
            "SELECT sleeper_player_id FROM roster_history WHERE season = $1 AND week = 1", TEST_SEASON
        )
        assert [r["sleeper_player_id"] for r in rows] == ["test-rh-p1"]


async def test_snapshot_week_is_a_full_replace_not_additive(pool):
    """A second snapshot_week call for the same week must reflect
    current_rosters exactly as it stands then — including a player who
    was dropped since the first snapshot — not accumulate stale rows."""
    team_id = await _seed_team(pool, 2)

    async with pool.acquire() as conn:
        await _add_player(conn, "test-rh-p2a", "Player A", team_id, "RB")
        await snapshot_week(conn, TEST_SEASON, 1)

        # Drop Player A, add Player B — real current_rosters churn within the week.
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = 'test-rh-p2a'",
            TEST_SEASON, team_id,
        )
        await _add_player(conn, "test-rh-p2b", "Player B", team_id, "RB")
        await snapshot_week(conn, TEST_SEASON, 1)

        rows = await conn.fetch(
            "SELECT sleeper_player_id FROM roster_history WHERE season = $1 AND week = 1 AND team_id = $2",
            TEST_SEASON, team_id,
        )
        assert [r["sleeper_player_id"] for r in rows] == ["test-rh-p2b"]


async def test_get_roster_for_week_reads_live_for_current_week(pool):
    """Even when a frozen snapshot exists for the current week, the
    current week must always read live current_rosters — it's still
    editable (waivers/trades/lineup swaps) until it's over."""
    team_id = await _seed_team(pool, 3)

    async with pool.acquire() as conn:
        await _add_player(conn, "test-rh-p3", "Player Three", team_id, "RB")
        await snapshot_week(conn, TEST_SEASON, 1)

        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 1) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        # A real mid-week roster change made AFTER the snapshot was taken.
        await _add_player(conn, "test-rh-p3b", "Player Three B", team_id, "WR")

        roster = await get_roster_for_week(conn, TEST_SEASON, team_id, 1)
        live = await get_current_roster(conn, TEST_SEASON, team_id, 1)
        assert {p["player_id"] for p in roster} == {p["player_id"] for p in live} == {
            "test-rh-p3", "test-rh-p3b",
        }


async def test_get_roster_for_week_reads_frozen_snapshot_for_a_past_week(pool):
    team_id = await _seed_team(pool, 4)

    async with pool.acquire() as conn:
        await _add_player(conn, "test-rh-p4", "Player Four", team_id, "RB")
        await snapshot_week(conn, TEST_SEASON, 1)

        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        # A roster change in week 2 must not retroactively alter week 1's history.
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )
        await _add_player(conn, "test-rh-p4-later", "Later Player", team_id, "RB")

        roster = await get_roster_for_week(conn, TEST_SEASON, team_id, 1)
        assert [p["player_id"] for p in roster] == ["test-rh-p4"]


async def test_get_roster_for_week_carries_forward_when_a_week_has_no_snapshot(pool):
    """Week 2 was never snapshotted (e.g. a sync outage) — the read
    falls back to week 1's frozen roster, per "assume the same roster
    unless a player makes a change," while still using week 2's own
    real score."""
    team_id = await _seed_team(pool, 5)

    async with pool.acquire() as conn:
        await _add_player(conn, "test-rh-p5", "Player Five", team_id, "RB")
        await snapshot_week(conn, TEST_SEASON, 1)

        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 3) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, fantasy_points) VALUES ($1, 2, $2, 14.5)",
            TEST_SEASON, "test-rh-p5",
        )

        latest = await get_latest_snapshotted_week(conn, TEST_SEASON, team_id, 2)
        assert latest == 1

        roster = await get_roster_for_week(conn, TEST_SEASON, team_id, 2)
        assert len(roster) == 1
        assert roster[0]["player_id"] == "test-rh-p5"
        assert roster[0]["points_scored"] == 14.5


async def test_get_roster_for_week_falls_back_to_live_when_no_snapshot_exists_at_all(pool):
    team_id = await _seed_team(pool, 6)

    async with pool.acquire() as conn:
        await _add_player(conn, "test-rh-p6", "Player Six", team_id, "RB")
        # No snapshot ever taken, no league_state cached either.
        roster = await get_roster_for_week(conn, TEST_SEASON, team_id, 5)
        assert [p["player_id"] for p in roster] == ["test-rh-p6"]
