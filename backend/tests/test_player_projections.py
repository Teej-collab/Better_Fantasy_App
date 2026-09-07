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
