from app.domain import player_projections


def _fake_get_projections(by_espn_id, resolved_ids_by_name=None):
    def fake(known_espn_ids, unresolved_names, config=None, season=None):
        return {"by_espn_id": by_espn_id, "resolved_ids_by_name": resolved_ids_by_name or {}}

    return fake


async def _seed_player(pool, suffix, *, espn_player_id=None, full_name=None, is_draftable=True):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, is_draftable)
            VALUES ($1, $2, $3, 'RB', $4)
            """,
            f"test-proj-{suffix}", espn_player_id, full_name or f"Test Player {suffix}", is_draftable,
        )
    return f"test-proj-{suffix}"


async def test_sync_projected_points_matches_by_espn_id(pool, monkeypatch):
    sleeper_id = await _seed_player(pool, "id-match", espn_player_id=555001)
    monkeypatch.setattr(
        player_projections,
        "get_projections",
        _fake_get_projections({555001: {"projected_points": 214.3, "projected_avg_points": 12.6}}),
    )

    async with pool.acquire() as conn:
        result = await player_projections.sync_projected_points(conn)
        row = await conn.fetchrow(
            "SELECT projected_points, projected_avg_points FROM players WHERE sleeper_player_id = $1", sleeper_id
        )

    assert result["matched_by_espn_id"] == 1
    assert float(row["projected_points"]) == 214.3
    assert float(row["projected_avg_points"]) == 12.6


async def test_sync_projected_points_matches_by_name_and_backfills_espn_id(pool, monkeypatch):
    sleeper_id = await _seed_player(pool, "name-match", espn_player_id=None, full_name="Test Nameonly Player")
    monkeypatch.setattr(
        player_projections,
        "get_projections",
        _fake_get_projections(
            {555002: {"projected_points": 88.5, "projected_avg_points": 5.2}},
            {"Test Nameonly Player": 555002},
        ),
    )

    async with pool.acquire() as conn:
        result = await player_projections.sync_projected_points(conn)
        row = await conn.fetchrow(
            "SELECT projected_points, espn_player_id FROM players WHERE sleeper_player_id = $1", sleeper_id
        )

    assert result["matched_by_name"] == 1
    assert float(row["projected_points"]) == 88.5
    assert row["espn_player_id"] == 555002


async def test_sync_projected_points_leaves_unmatched_players_null(pool, monkeypatch):
    sleeper_id = await _seed_player(pool, "unmatched", espn_player_id=None, full_name="Nobody Matches This Name")
    monkeypatch.setattr(
        player_projections,
        "get_projections",
        _fake_get_projections({555003: {"projected_points": 50.0, "projected_avg_points": 3.0}}),
    )

    async with pool.acquire() as conn:
        await player_projections.sync_projected_points(conn)
        row = await conn.fetchrow("SELECT projected_points FROM players WHERE sleeper_player_id = $1", sleeper_id)

    assert row["projected_points"] is None


async def test_sync_projected_points_reports_espn_players_seen(pool, monkeypatch):
    monkeypatch.setattr(
        player_projections,
        "get_projections",
        _fake_get_projections(
            {
                555004: {"projected_points": 10.0, "projected_avg_points": 1.0},
                555005: {"projected_points": 20.0, "projected_avg_points": 2.0},
            }
        ),
    )

    async with pool.acquire() as conn:
        result = await player_projections.sync_projected_points(conn)

    assert result["espn_players_seen"] == 2


async def test_sync_weekly_projections_fills_upcoming_weeks_and_keeps_current_week(pool, monkeypatch):
    from tests.conftest import TEST_SEASON

    sleeper_id = await _seed_player(pool, "weekly", espn_player_id=9990001)
    asked = {}

    def fake_weekly(espn_ids, weeks, config=None, season=None):
        asked["weeks"] = weeks
        return {week: {9990001: 10.0 + week} for week in weeks}

    monkeypatch.setattr(player_projections, "get_weekly_projections", fake_weekly)
    async with pool.acquire() as conn:
        await conn.execute("UPDATE players SET projected_avg_points = 12.5 WHERE sleeper_player_id = $1", sleeper_id)
        await conn.execute("INSERT INTO league_state (season, current_week) VALUES ($1, 16)", TEST_SEASON)
        # This week's box-score projection is already in; past weeks are history.
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
            "VALUES ($1, 16, $2, 7.7), ($1, 15, $2, 3.3)",
            TEST_SEASON, sleeper_id,
        )

        result = await player_projections.sync_weekly_projections(conn, season=TEST_SEASON)
        rows = await conn.fetch(
            "SELECT week, projected_points FROM player_weekly_projections "
            "WHERE season = $1 AND sleeper_player_id = $2 ORDER BY week",
            TEST_SEASON, sleeper_id,
        )

    assert asked["weeks"] == [16, 17, 18]
    assert result["weeks"] == 3
    assert {r["week"]: float(r["projected_points"]) for r in rows} == {15: 3.3, 16: 7.7, 17: 27.0, 18: 28.0}
