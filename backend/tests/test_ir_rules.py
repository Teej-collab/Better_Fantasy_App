import json

import pytest

from app.config import DEFAULT_LEAGUE_ID
from app.domain import trades, waivers
from app.domain.ir_rules import count_roster_toward_limit, ineligible_ir_player_names
from app.domain.lineup_engine import add_free_agent
from app.domain.lineup_exceptions import IRSlotViolationError, RosterFullError
from app.domain.trade_exceptions import IRSlotViolationTradeError
from app.domain.waiver_exceptions import IRSlotViolationClaimError
from tests.conftest import TEST_SEASON

# 9 starters + 2 bench = 11 counted spots; IR is on top of that.
_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2, "IR": 1}
_CAPACITY = 11


async def _seed_team(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-ir-owner-{suffix}", f"Owner {suffix}",
        )
        return await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"IR Team {suffix}",
        )


async def _seed_player(pool, suffix, injury_status=None):
    sleeper_id = f"test-ir-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, injury_status, is_draftable)
            VALUES ($1, $2, 'RB', ARRAY['RB'], 'KC', 'Active', $3, TRUE)
            """,
            sleeper_id, f"IR Player {suffix}", injury_status,
        )
    return sleeper_id


async def _roster(pool, team_id, sleeper_player_id, lineup_slot="BE"):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, $4, 'draft', $5)",
            TEST_SEASON, team_id, sleeper_player_id, lineup_slot, DEFAULT_LEAGUE_ID,
        )


async def _seed_roster_config(pool):
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", TEST_SEASON)
        if not exists:
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, $3)",
                TEST_SEASON, [], json.dumps(_ROSTER_SLOTS),
            )


async def _full_team_with_ir(pool, suffix, espn_team_id, ir_status):
    """A team with every counted spot filled plus one player on IR."""
    await _seed_roster_config(pool)
    team_id = await _seed_team(pool, suffix, espn_team_id)
    for i in range(_CAPACITY):
        await _roster(pool, team_id, await _seed_player(pool, f"{suffix}-{i}"))
    ir_player = await _seed_player(pool, f"{suffix}-ir", injury_status=ir_status)
    await _roster(pool, team_id, ir_player, lineup_slot="IR")
    return team_id, ir_player


async def test_ir_player_does_not_count_toward_roster_limit(pool):
    team_id, _ = await _full_team_with_ir(pool, "count", 401, "Out")
    async with pool.acquire() as conn:
        assert await count_roster_toward_limit(conn, TEST_SEASON, team_id) == _CAPACITY


async def test_moving_a_player_to_ir_opens_a_spot_for_an_add(pool):
    """The real 2026-09-23 bug: a full roster that stashes an Out player
    on IR must have room to add someone to the spot that opened up."""
    await _seed_roster_config(pool)
    team_id = await _seed_team(pool, "open", 402)
    for i in range(_CAPACITY - 1):
        await _roster(pool, team_id, await _seed_player(pool, f"open-{i}"))
    injured = await _seed_player(pool, "open-injured", injury_status="Out")
    await _roster(pool, team_id, injured)
    fa = await _seed_player(pool, "open-fa")
    async with pool.acquire() as conn:
        with pytest.raises(RosterFullError):
            await add_free_agent(conn, TEST_SEASON, team_id, fa, league_id=DEFAULT_LEAGUE_ID)
        await conn.execute(
            "UPDATE current_rosters SET lineup_slot = 'IR' WHERE season = $1 AND sleeper_player_id = $2",
            TEST_SEASON, injured,
        )
        result = await add_free_agent(conn, TEST_SEASON, team_id, fa, league_id=DEFAULT_LEAGUE_ID)
    assert result["dropped_player"] is None


async def test_full_roster_plus_eligible_ir_player_is_still_full(pool):
    team_id, _ = await _full_team_with_ir(pool, "full", 403, "Out")
    fa = await _seed_player(pool, "full-fa")
    async with pool.acquire() as conn:
        with pytest.raises(RosterFullError):
            await add_free_agent(conn, TEST_SEASON, team_id, fa, league_id=DEFAULT_LEAGUE_ID)


async def test_ineligible_ir_player_blocks_free_agent_add(pool):
    team_id, _ = await _full_team_with_ir(pool, "doubtful", 404, "Doubtful")
    fa = await _seed_player(pool, "doubtful-fa")
    async with pool.acquire() as conn:
        with pytest.raises(IRSlotViolationError):
            await add_free_agent(
                conn, TEST_SEASON, team_id, fa, "test-ir-player-doubtful-0", league_id=DEFAULT_LEAGUE_ID,
            )


async def test_healthy_ir_player_counts_as_ineligible(pool):
    team_id, _ = await _full_team_with_ir(pool, "healthy", 405, None)
    async with pool.acquire() as conn:
        names = await ineligible_ir_player_names(conn, TEST_SEASON, team_id)
    assert names == ["IR Player healthy-ir"]


async def test_dropping_the_ineligible_ir_player_in_the_same_add_is_allowed(pool):
    team_id, ir_player = await _full_team_with_ir(pool, "dropir", 406, "Doubtful")
    fa = await _seed_player(pool, "dropir-fa")
    async with pool.acquire() as conn:
        result = await add_free_agent(conn, TEST_SEASON, team_id, fa, ir_player, league_id=DEFAULT_LEAGUE_ID)
    assert result["dropped_player"]["sleeper_player_id"] == ir_player


async def test_ineligible_ir_player_blocks_waiver_claim(pool):
    team_id, _ = await _full_team_with_ir(pool, "claim", 407, "Questionable")
    target = await _seed_player(pool, "claim-target")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, target)
        with pytest.raises(IRSlotViolationClaimError):
            await waivers.submit_claim(
                conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, target, "test-ir-player-claim-0",
            )


async def test_claim_fails_at_processing_if_ir_player_became_ineligible(pool):
    team_id, ir_player = await _full_team_with_ir(pool, "process", 408, "Out")
    target = await _seed_player(pool, "process-target")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, target)
        claim = await waivers.submit_claim(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, target, "test-ir-player-process-0",
        )
        await conn.execute("UPDATE players SET injury_status = 'Doubtful' WHERE sleeper_player_id = $1", ir_player)
        await conn.execute(
            "UPDATE waiver_wire SET clears_at = now() - interval '1 hour' WHERE season = $1 AND sleeper_player_id = $2",
            TEST_SEASON, target,
        )
        await waivers.process_expired_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=3)
        row = await conn.fetchrow("SELECT status, failure_reason FROM waiver_claims WHERE id = $1", claim["id"])
    assert row["status"] == "failed"
    assert "no longer eligible for IR" in row["failure_reason"]


async def test_ineligible_ir_player_blocks_trade_unless_traded_away(pool):
    team_a, ir_player = await _full_team_with_ir(pool, "trade-a", 409, "Doubtful")
    team_b, _ = await _full_team_with_ir(pool, "trade-b", 410, "Out")
    async with pool.acquire() as conn:
        with pytest.raises(IRSlotViolationTradeError):
            await trades._validate_assets(
                conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_a, team_b,
                ["test-ir-player-trade-a-0"], ["test-ir-player-trade-b-0"],
            )
        # Trading the ineligible IR player away resolves it.
        await trades._validate_assets(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_a, team_b, [ir_player], ["test-ir-player-trade-b-0"],
        )
