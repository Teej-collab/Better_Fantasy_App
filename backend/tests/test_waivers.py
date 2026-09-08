import json

from app.config import DEFAULT_LEAGUE_ID
from app.domain import waivers
from app.domain.lineup_engine import add_free_agent
from app.domain.lineup_exceptions import PlayerNotOnRosterError, PlayerOnWaiversError
from app.domain.waiver_exceptions import (
    ClaimNotCancellableError,
    ClaimNotFoundError,
    DuplicateClaimError,
    PlayerNotOnWaiversError,
)
from tests.conftest import TEST_SEASON


async def _seed_owner_with_team(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-waivers-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Waiver Team {suffix}",
        )
    return owner_id, team_id


async def _seed_player(pool, suffix, position="RB"):
    sleeper_id = f"test-waivers-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE)
            """,
            sleeper_id, f"Test Player {suffix}", position, [position],
        )
    return sleeper_id


async def _seed_roster_entry(pool, team_id, sleeper_player_id, lineup_slot="BE"):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, $4, 'draft')",
            TEST_SEASON, team_id, sleeper_player_id, lineup_slot,
        )


async def _seed_roster_config(pool, roster_slots=None):
    slots = roster_slots or {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", TEST_SEASON)
        if not exists:
            await conn.execute(
                "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, $2, $3)",
                TEST_SEASON, [], json.dumps(slots),
            )


async def _seed_matchup(pool, week, home_team_id, away_team_id, home_score, away_score):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            TEST_SEASON, week, home_team_id, away_team_id, home_score, away_score,
        )


async def _force_expire(pool, sleeper_player_id):
    """Backdates a waiver_wire row's clears_at into the past, bypassing
    the real 1-day clock so a test can exercise process_expired_waivers
    without actually waiting a day."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE waiver_wire SET clears_at = now() - interval '1 hour' "
            "WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, DEFAULT_LEAGUE_ID, sleeper_player_id,
        )


async def test_start_waiver_clock_and_is_on_waivers(pool):
    player = await _seed_player(pool, "clock1")
    async with pool.acquire() as conn:
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is False
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is True

    await _force_expire(pool, player)
    async with pool.acquire() as conn:
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is False


async def test_get_waiver_clears_at_bulk_only_includes_waived_players(pool):
    waived = await _seed_player(pool, "bulk1")
    free = await _seed_player(pool, "bulk2")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, waived)
        result = await waivers.get_waiver_clears_at(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, [waived, free])
    assert waived in result
    assert free not in result


async def test_submit_claim_rejects_player_not_on_waivers(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "claim1", espn_team_id=201)
    player = await _seed_player(pool, "claim1")
    async with pool.acquire() as conn:
        try:
            await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player)
            assert False, "expected PlayerNotOnWaiversError"
        except PlayerNotOnWaiversError:
            pass


async def test_submit_claim_happy_path(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "claim2", espn_team_id=202)
    player = await _seed_player(pool, "claim2")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        claim = await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player)
    assert claim["status"] == "pending"
    assert claim["add_sleeper_player_id"] == player


async def test_submit_claim_rejects_duplicate(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "claim3", espn_team_id=203)
    player = await _seed_player(pool, "claim3")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player)
        try:
            await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player)
            assert False, "expected DuplicateClaimError"
        except DuplicateClaimError:
            pass


async def test_submit_claim_rejects_drop_target_not_on_roster(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "claim4", espn_team_id=204)
    player = await _seed_player(pool, "claim4")
    not_rostered = await _seed_player(pool, "claim4b")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        try:
            await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player, not_rostered)
            assert False, "expected PlayerNotOnRosterError"
        except PlayerNotOnRosterError:
            pass


async def test_cancel_claim_happy_path_and_rejects_twice(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "cancel1", espn_team_id=205)
    player = await _seed_player(pool, "cancel1")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        claim = await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player)
        await waivers.cancel_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, claim["id"])
        claims = await waivers.list_claims_for_team(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id)
        assert claims[0]["status"] == "cancelled"
        try:
            await waivers.cancel_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, claim["id"])
            assert False, "expected ClaimNotCancellableError"
        except ClaimNotCancellableError:
            pass


async def test_cancel_claim_not_found(pool):
    _, team_id = await _seed_owner_with_team(pool, "cancel2", espn_team_id=206)
    async with pool.acquire() as conn:
        try:
            await waivers.cancel_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, 999999999)
            assert False, "expected ClaimNotFoundError"
        except ClaimNotFoundError:
            pass


async def test_priority_order_seeds_worst_record_first(pool):
    _, team_a = await _seed_owner_with_team(pool, "prio1a", espn_team_id=207)  # will lose
    _, team_b = await _seed_owner_with_team(pool, "prio1b", espn_team_id=208)  # will win
    await _seed_matchup(pool, week=1, home_team_id=team_a, away_team_id=team_b, home_score=10, away_score=20)

    async with pool.acquire() as conn:
        order = await waivers.get_priority_order(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=2)

    by_team = {row["team_id"]: row["priority"] for row in order}
    assert by_team[team_a] < by_team[team_b]  # the loser (worse record) picks first


async def test_process_expired_waivers_with_no_claims_just_clears(pool):
    player = await _seed_player(pool, "expire1")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
    await _force_expire(pool, player)

    async with pool.acquire() as conn:
        results = await waivers.process_expired_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=1)
        assert results == [{"sleeper_player_id": player, "outcomes": []}]
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is False


async def test_process_expired_waivers_single_claim_succeeds_and_bumps_priority(pool):
    await _seed_roster_config(pool)
    _, team_a = await _seed_owner_with_team(pool, "expire2a", espn_team_id=209)
    _, team_b = await _seed_owner_with_team(pool, "expire2b", espn_team_id=210)
    await _seed_matchup(pool, week=1, home_team_id=team_a, away_team_id=team_b, home_score=10, away_score=20)
    player = await _seed_player(pool, "expire2")

    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        claim = await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_a, player)
        order_before = {r["team_id"]: r["priority"] for r in await waivers.get_priority_order(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=2)}
    await _force_expire(pool, player)

    async with pool.acquire() as conn:
        results = await waivers.process_expired_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=2)
        roster = await conn.fetch(
            "SELECT sleeper_player_id, acquired_via FROM current_rosters WHERE season = $1 AND team_id = $2",
            TEST_SEASON, team_a,
        )
        claims = await waivers.list_claims_for_team(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_a)
        order_after = {r["team_id"]: r["priority"] for r in await waivers.get_priority_order(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=2)}

    assert results[0]["outcomes"] == [{"claim_id": claim["id"], "status": "successful"}]
    assert any(r["sleeper_player_id"] == player and r["acquired_via"] == "waiver" for r in roster)
    assert claims[0]["status"] == "successful"
    # Winning a claim bumps that team to the back of THIS week's list.
    assert order_after[team_a] > order_before[team_a]


async def test_process_expired_waivers_higher_priority_claim_wins_the_contested_player(pool):
    await _seed_roster_config(pool)
    _, worse_team = await _seed_owner_with_team(pool, "expire3a", espn_team_id=211)
    _, better_team = await _seed_owner_with_team(pool, "expire3b", espn_team_id=212)
    # worse_team loses (0-1), better_team wins (1-0) — worse_team gets priority 1.
    await _seed_matchup(pool, week=1, home_team_id=worse_team, away_team_id=better_team, home_score=5, away_score=25)
    player = await _seed_player(pool, "expire3")

    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        losing_claim = await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, better_team, player)
        winning_claim = await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, worse_team, player)
    await _force_expire(pool, player)

    async with pool.acquire() as conn:
        await waivers.process_expired_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=2)
        worse_claims = {c["id"]: c["status"] for c in await waivers.list_claims_for_team(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, worse_team)}
        better_claims = {c["id"]: c["status"] for c in await waivers.list_claims_for_team(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, better_team)}
        rostered_by = await conn.fetchval(
            "SELECT team_id FROM current_rosters WHERE season = $1 AND sleeper_player_id = $2", TEST_SEASON, player
        )

    assert worse_claims[winning_claim["id"]] == "successful"
    assert better_claims[losing_claim["id"]] == "failed"
    assert rostered_by == worse_team


async def test_process_expired_waivers_winner_drop_target_starts_new_waiver_clock(pool):
    await _seed_roster_config(pool)
    _, team_a = await _seed_owner_with_team(pool, "expire4a", espn_team_id=213)
    _, team_b = await _seed_owner_with_team(pool, "expire4b", espn_team_id=214)
    await _seed_matchup(pool, week=1, home_team_id=team_a, away_team_id=team_b, home_score=10, away_score=20)
    incoming = await _seed_player(pool, "expire4in")
    outgoing = await _seed_player(pool, "expire4out")
    await _seed_roster_entry(pool, team_a, outgoing, lineup_slot="BE")

    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, incoming)
        await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_a, incoming, outgoing)
    await _force_expire(pool, incoming)

    async with pool.acquire() as conn:
        await waivers.process_expired_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, week=2)
        still_rostered = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, team_a, outgoing,
        )
        assert still_rostered is None
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, outgoing) is True


async def test_add_free_agent_rejects_a_player_still_on_waivers(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "reject1", espn_team_id=215)
    player = await _seed_player(pool, "reject1")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        try:
            await add_free_agent(conn, TEST_SEASON, team_id, player)
            assert False, "expected PlayerOnWaiversError"
        except PlayerOnWaiversError:
            pass


async def test_add_free_agent_allowed_once_waivers_have_cleared(pool):
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "clear1", espn_team_id=216)
    player = await _seed_player(pool, "clear1")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
    await _force_expire(pool, player)

    async with pool.acquire() as conn:
        result = await add_free_agent(conn, TEST_SEASON, team_id, player)
    assert any(r["sleeper_player_id"] == player for r in result["roster"])
