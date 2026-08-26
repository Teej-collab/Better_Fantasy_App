import json

from app.domain import weekly_stats
from tests.conftest import TEST_SEASON

_RULES = [
    ("pass_yd", 0.04), ("pass_td", 4), ("pass_int", -2),
    ("rec", 1), ("rec_yd", 0.1), ("rec_td", 6),
]

_FAKE_PLAYERS_BY_EVENT = {
    "event-1": [
        {"espn_player_id": 111, "player_name": "Test QB", "pro_team": "KC",
         "stat_line": {"pass_yd": 250, "pass_td": 2, "pass_int": 1}},
        {"espn_player_id": 222, "player_name": "Test WR (no crosswalk)", "pro_team": "KC",
         "stat_line": {"rec": 5, "rec_yd": 60, "rec_td": 0}},
    ],
}


async def _fake_get_game_player_stats(event_id):
    return _FAKE_PLAYERS_BY_EVENT.get(event_id, [])


async def _seed_rules(pool):
    async with pool.acquire() as conn:
        for stat_category, points_per_unit in _RULES:
            await conn.execute(
                "INSERT INTO league_scoring_rules (season, stat_category, points_per_unit) VALUES ($1, $2, $3)",
                TEST_SEASON, stat_category, points_per_unit,
            )


async def _seed_player(pool, sleeper_id, espn_player_id, position="QB"):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, $5, 'KC', 'Active', TRUE)
            """,
            sleeper_id, espn_player_id, f"Test Player {sleeper_id}", position, [position],
        )


async def test_compute_week_player_stats_writes_matched_players_only(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_game_player_stats", _fake_get_game_player_stats)
    await _seed_rules(pool)
    await _seed_player(pool, "test-weeklystats-qb", espn_player_id=111, position="QB")
    # No player seeded for espn_player_id=222 — should be silently skipped.

    async with pool.acquire() as conn:
        written = await weekly_stats.compute_week_player_stats(conn, TEST_SEASON, 1, ["event-1"])

    assert written == 1
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, "test-weeklystats-qb",
        )
    assert row is not None
    # 250*0.04=10, 2*4=8, 1*-2=-2 -> 16
    assert float(row["fantasy_points"]) == 16.0
    assert json.loads(row["raw_stats"]) == {"pass_yd": 250, "pass_td": 2, "pass_int": 1}


async def test_compute_week_player_stats_is_idempotent_on_rerun(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_game_player_stats", _fake_get_game_player_stats)
    await _seed_rules(pool)
    await _seed_player(pool, "test-weeklystats-qb2", espn_player_id=111, position="QB")

    async with pool.acquire() as conn:
        await weekly_stats.compute_week_player_stats(conn, TEST_SEASON, 1, ["event-1"])
        await weekly_stats.compute_week_player_stats(conn, TEST_SEASON, 1, ["event-1"])
        count = await conn.fetchval(
            "SELECT count(*) FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, "test-weeklystats-qb2",
        )
    assert count == 1


async def test_compute_week_player_stats_raises_without_scoring_rules(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_game_player_stats", _fake_get_game_player_stats)
    # No rules seeded for TEST_SEASON.
    async with pool.acquire() as conn:
        try:
            await weekly_stats.compute_week_player_stats(conn, TEST_SEASON, 1, ["event-1"])
            assert False, "expected ValueError"
        except ValueError:
            pass
