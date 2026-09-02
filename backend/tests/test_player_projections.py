from app.domain import player_projections


def _fake_espn_players(rows):
    def fake(config=None, season=None):
        return rows

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
        "get_all_projected_points",
        _fake_espn_players([{"espn_player_id": 555001, "name": "Someone Else Entirely", "projected_points": 214.3}]),
    )

    async with pool.acquire() as conn:
        result = await player_projections.sync_projected_points(conn)
        row = await conn.fetchrow("SELECT projected_points FROM players WHERE sleeper_player_id = $1", sleeper_id)

    assert result["matched_by_espn_id"] == 1
    assert float(row["projected_points"]) == 214.3


async def test_sync_projected_points_matches_by_name_and_backfills_espn_id(pool, monkeypatch):
    sleeper_id = await _seed_player(pool, "name-match", espn_player_id=None, full_name="Test Nameonly Player")
    monkeypatch.setattr(
        player_projections,
        "get_all_projected_points",
        _fake_espn_players([{"espn_player_id": 555002, "name": "Test Nameonly Player", "projected_points": 88.5}]),
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
        "get_all_projected_points",
        _fake_espn_players([{"espn_player_id": 555003, "name": "A Totally Different Player", "projected_points": 50.0}]),
    )

    async with pool.acquire() as conn:
        await player_projections.sync_projected_points(conn)
        row = await conn.fetchrow("SELECT projected_points FROM players WHERE sleeper_player_id = $1", sleeper_id)

    assert row["projected_points"] is None


async def test_sync_projected_points_reports_espn_free_agents_seen(pool, monkeypatch):
    monkeypatch.setattr(
        player_projections,
        "get_all_projected_points",
        _fake_espn_players(
            [
                {"espn_player_id": 555004, "name": "Player A", "projected_points": 10.0},
                {"espn_player_id": 555005, "name": "Player B", "projected_points": 20.0},
            ]
        ),
    )

    async with pool.acquire() as conn:
        result = await player_projections.sync_projected_points(conn)

    assert result["espn_free_agents_seen"] == 2
