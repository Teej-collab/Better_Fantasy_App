import itertools

from app.config import DEFAULT_LEAGUE_ID
from app.queries.roster_transactions import log_transaction
from tests.conftest import TEST_SEASON

_espn_team_ids = itertools.count(920000)


async def _seed_owner_with_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-roster-txn-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, next(_espn_team_ids), owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def _seed_player(pool, suffix, position="RB"):
    sleeper_id = f"test-roster-txn-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE)
            """,
            sleeper_id, f"Test Player {suffix}", position, [position],
        )
    return sleeper_id


async def test_log_transaction_records_an_add_only(pool):
    _, team_id = await _seed_owner_with_team(pool, "add-only")
    player_id = await _seed_player(pool, "add-only")

    async with pool.acquire() as conn:
        await log_transaction(conn, TEST_SEASON, team_id, source="free_agent", added_sleeper_player_id=player_id)
        row = await conn.fetchrow(
            "SELECT * FROM roster_transactions WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )

    assert row["added_sleeper_player_id"] == player_id
    assert row["dropped_sleeper_player_id"] is None
    assert row["source"] == "free_agent"
    assert row["league_id"] == DEFAULT_LEAGUE_ID


async def test_log_transaction_records_a_drop_only(pool):
    _, team_id = await _seed_owner_with_team(pool, "drop-only")
    player_id = await _seed_player(pool, "drop-only")

    async with pool.acquire() as conn:
        await log_transaction(conn, TEST_SEASON, team_id, source="free_agent", dropped_sleeper_player_id=player_id)
        row = await conn.fetchrow(
            "SELECT * FROM roster_transactions WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )

    assert row["added_sleeper_player_id"] is None
    assert row["dropped_sleeper_player_id"] == player_id


async def test_log_transaction_records_a_swap_as_one_row(pool):
    _, team_id = await _seed_owner_with_team(pool, "swap")
    added = await _seed_player(pool, "swap-add")
    dropped = await _seed_player(pool, "swap-drop")

    async with pool.acquire() as conn:
        await log_transaction(
            conn, TEST_SEASON, team_id, source="waiver",
            added_sleeper_player_id=added, dropped_sleeper_player_id=dropped,
        )
        rows = await conn.fetch(
            "SELECT * FROM roster_transactions WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )

    assert len(rows) == 1
    assert rows[0]["added_sleeper_player_id"] == added
    assert rows[0]["dropped_sleeper_player_id"] == dropped
    assert rows[0]["source"] == "waiver"


async def test_log_transaction_is_a_no_op_with_nothing_to_log(pool):
    _, team_id = await _seed_owner_with_team(pool, "noop")

    async with pool.acquire() as conn:
        await log_transaction(conn, TEST_SEASON, team_id, source="free_agent")
        count = await conn.fetchval(
            "SELECT count(*) FROM roster_transactions WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )

    assert count == 0
