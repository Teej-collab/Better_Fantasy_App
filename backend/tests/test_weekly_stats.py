import json

from app.domain import weekly_stats
from tests.conftest import TEST_SEASON

_RULES = [
    ("pass_yd", 0.04), ("pass_td", 4), ("pass_int", -2),
    ("rec", 1), ("rec_yd", 0.1), ("rec_td", 6),
    ("def_sack", 1), ("pts_allow_18_27", 0),
]

_TEST_DST = "test-dst-tm1"  # a fake team abbreviation — real ones (KC, SF, ...) already exist as
# real DEF rows from the actual Sleeper ingestion this session ran, so a real
# abbreviation here would collide with production data rather than be test-isolated.
_UNSEEDED_DST = "test-dst-tm2"

_FAKE_GAME_BY_EVENT = {
    "event-1": {
        "players": [
            {"espn_player_id": 111, "player_name": "Test QB", "pro_team": "KC",
             "stat_line": {"pass_yd": 250, "pass_td": 2, "pass_int": 1}},
            {"espn_player_id": 222, "player_name": "Test WR (no crosswalk)", "pro_team": "KC",
             "stat_line": {"rec": 5, "rec_yd": 60, "rec_td": 0}},
        ],
        "team_dst": {
            _TEST_DST: {"def_sack": 3, "pts_allow_18_27": 1},
            _UNSEEDED_DST: {"def_sack": 1},  # no matching `players` DEF row seeded — should be skipped
        },
    },
}


async def _fake_get_game_stats(event_id):
    return _FAKE_GAME_BY_EVENT.get(event_id, {"players": [], "team_dst": {}})


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


async def _seed_dst(pool, team_abbr):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, 'DEF', ARRAY['DEF'], $1, 'Active', TRUE)
            """,
            team_abbr, f"Test {team_abbr} DEF",
        )


async def test_compute_week_stats_writes_matched_players_and_dst_only(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_game_stats", _fake_get_game_stats)
    await _seed_rules(pool)
    await _seed_player(pool, "test-weeklystats-qb", espn_player_id=111, position="QB")
    await _seed_dst(pool, _TEST_DST)
    # No player seeded for espn_player_id=222 (WR), no DEF seeded for _UNSEEDED_DST — both skipped.

    async with pool.acquire() as conn:
        counts = await weekly_stats.compute_week_stats(conn, TEST_SEASON, 1, ["event-1"])

    assert counts == {"players": 1, "team_dst": 1}

    async with pool.acquire() as conn:
        qb_row = await conn.fetchrow(
            "SELECT * FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, "test-weeklystats-qb",
        )
        dst_row = await conn.fetchrow(
            "SELECT * FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, _TEST_DST,
        )
        unseeded_row = await conn.fetchrow(
            "SELECT * FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, _UNSEEDED_DST,
        )

    # 250*0.04=10, 2*4=8, 1*-2=-2 -> 16
    assert float(qb_row["fantasy_points"]) == 16.0
    assert json.loads(qb_row["raw_stats"]) == {"pass_yd": 250, "pass_td": 2, "pass_int": 1}

    # 10 (baseline) + 3*1=3 + 1*0=0 -> 13
    assert float(dst_row["fantasy_points"]) == 13.0
    assert json.loads(dst_row["raw_stats"]) == {"def_sack": 3, "pts_allow_18_27": 1}

    assert unseeded_row is None  # no `players` DEF row for this abbreviation — skipped


async def test_compute_week_stats_is_idempotent_on_rerun(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_game_stats", _fake_get_game_stats)
    await _seed_rules(pool)
    await _seed_player(pool, "test-weeklystats-qb2", espn_player_id=111, position="QB")
    await _seed_dst(pool, _TEST_DST)

    async with pool.acquire() as conn:
        await weekly_stats.compute_week_stats(conn, TEST_SEASON, 1, ["event-1"])
        await weekly_stats.compute_week_stats(conn, TEST_SEASON, 1, ["event-1"])
        player_count = await conn.fetchval(
            "SELECT count(*) FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, "test-weeklystats-qb2",
        )
        dst_count = await conn.fetchval(
            "SELECT count(*) FROM player_week_stats WHERE season = $1 AND week = 1 AND sleeper_player_id = $2",
            TEST_SEASON, _TEST_DST,
        )
    assert player_count == 1
    assert dst_count == 1


async def test_compute_week_stats_raises_without_scoring_rules(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_game_stats", _fake_get_game_stats)
    # No rules seeded for TEST_SEASON.
    async with pool.acquire() as conn:
        try:
            await weekly_stats.compute_week_stats(conn, TEST_SEASON, 1, ["event-1"])
            assert False, "expected ValueError"
        except ValueError:
            pass


async def _fake_get_week_scoreboard(week, year, season_type=2):
    return [{"id": "event-1"}, {"id": None}]  # a malformed/no-id event should be filtered out


async def _seed_team_for_matchup(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-weeklystats-owner-{suffix}", f"Owner {suffix}",
        )
        return await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )


async def test_compute_and_store_week_sources_events_and_updates_matchups(pool, monkeypatch):
    monkeypatch.setattr(weekly_stats, "get_week_scoreboard", _fake_get_week_scoreboard)
    monkeypatch.setattr(weekly_stats, "get_game_stats", _fake_get_game_stats)
    await _seed_rules(pool)
    await _seed_player(pool, "test-weeklystats-qb3", espn_player_id=111, position="QB")
    await _seed_dst(pool, _TEST_DST)

    home_id = await _seed_team_for_matchup(pool, "home", 701)
    away_id = await _seed_team_for_matchup(pool, "away", 702)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'QB', 'draft')",
            TEST_SEASON, home_id, "test-weeklystats-qb3",
        )
        matchup_id = await conn.fetchval(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 1, home_id, away_id,
        )

    results = await weekly_stats.compute_and_store_week(pool, TEST_SEASON, 1)

    assert results == {"event_count": 1, "players": 1, "team_dst": 1, "matchups_updated": 1}

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT home_score, away_score FROM matchups WHERE id = $1", matchup_id)
    # 250*0.04=10, 2*4=8, 1*-2=-2 -> 16, matching the QB's stat line above.
    assert float(row["home_score"]) == 16.0
    assert float(row["away_score"]) == 0.0
