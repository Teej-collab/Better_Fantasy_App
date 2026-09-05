"""Tests for app/domain/draft_engine.py — snake order math, turn
enforcement, autopick, and undo. Uses real `players`/`owners`/
`teams_by_season` rows (test-prefixed) rather than fakes, since the
engine's whole job is DB transaction/locking correctness, not
provider-shaped data."""
import asyncio
import itertools
import json
from datetime import datetime, timezone

from app.domain import draft_engine
from app.domain.draft_exceptions import (
    DraftAlreadyExistsError,
    DraftNotFoundError,
    DraftNotInProgressError,
    KeeperResolutionError,
    KeeperSelectionsNotLockedError,
    NothingToUndoError,
    NotYourTurnError,
    PlayerAlreadyDraftedError,
    PlayerNotDraftableError,
)
from tests.conftest import TEST_SEASON

_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}


def test_plan_snake_order_reverses_even_rounds():
    picks = draft_engine.plan_snake_order([1, 2, 3], rounds=3)
    round_1 = [p for p in picks if p[1] == 1]
    round_2 = [p for p in picks if p[1] == 2]
    round_3 = [p for p in picks if p[1] == 3]
    assert [p[3] for p in round_1] == [1, 2, 3]
    assert [p[3] for p in round_2] == [3, 2, 1]
    assert [p[3] for p in round_3] == [1, 2, 3]
    assert [p[0] for p in picks] == list(range(1, 10))  # pick_number is sequential


def test_total_draftable_slots_excludes_ir():
    slots = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7, "IR": 1}
    assert draft_engine.total_draftable_slots(slots) == 16


_espn_team_id_counter = itertools.count(900001)


async def _seed_owner_and_team(pool, suffix):
    espn_team_id = next(_espn_team_id_counter)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-draft-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def _seed_player(pool, suffix, position="RB", search_rank=100, draftable=True, espn_player_id=None):
    sleeper_id = f"test-draft-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, fantasy_positions, pro_team, status, search_rank, is_draftable)
            VALUES ($1, $2, $3, $4, $5, 'KC', 'Active', $6, $7)
            """,
            sleeper_id, espn_player_id, f"Test Player {suffix}", position, [position], search_rank, draftable,
        )
    return sleeper_id


async def _setup_two_team_draft(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "a")
    owner_b, _ = await _seed_owner_and_team(pool, "b")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        await draft_engine.start_draft(conn, TEST_SEASON)
    return owner_a, owner_b


async def test_make_pick_succeeds_for_the_team_on_the_clock(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "1")

    async with pool.acquire() as conn:
        result = await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)

    assert result["pick"]["sleeper_player_id"] == player
    assert result["pick"]["owner_id"] == owner_a
    assert result["config"]["current_pick_number"] == 2


async def test_make_pick_rejects_out_of_turn(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "2")

    async with pool.acquire() as conn:
        try:
            await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player)
            assert False, "expected NotYourTurnError"
        except NotYourTurnError:
            pass


async def test_make_pick_rejects_already_drafted_player(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "3")

    async with pool.acquire() as conn:
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)

    other_player = await _seed_player(pool, "4")
    async with pool.acquire() as conn:
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, other_player)  # advances to round 2, owner_b again (snake)

    async with pool.acquire() as conn:
        try:
            await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player)
            assert False, "expected PlayerAlreadyDraftedError"
        except PlayerAlreadyDraftedError:
            pass


async def test_make_pick_rejects_non_draftable_player(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "5", draftable=False)

    async with pool.acquire() as conn:
        try:
            await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)
            assert False, "expected PlayerNotDraftableError"
        except PlayerNotDraftableError:
            pass


async def test_make_pick_seeds_current_rosters(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "6")

    async with pool.acquire() as conn:
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_a
        )
        row = await conn.fetchrow(
            "SELECT * FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, team_id, player,
        )
    assert row is not None
    assert row["acquired_via"] == "draft"


async def test_round_1_pick_gets_a_90_second_deadline(pool):
    await _setup_two_team_draft(pool)
    async with pool.acquire() as conn:
        config = await conn.fetchrow(
            "SELECT current_pick_deadline FROM draft_config WHERE season = $1", TEST_SEASON
        )
    remaining = (config["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()
    assert 85 <= remaining <= 90


async def test_round_2_pick_gets_a_60_second_deadline(pool):
    owner_a, _owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "r2")

    async with pool.acquire() as conn:
        # Snake order for 2 teams: round 1 = [a, b], round 2 = [b, a] —
        # owner_a's own pick here is round 1, so the pick that opens
        # right after it (owner_b, still round 1) is the one to check.
        result = await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)

    remaining = (result["config"]["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()
    assert 85 <= remaining <= 90  # still owner_b's round-1 pick, not round 2 yet


async def test_autopicked_owner_gets_a_5_second_grace_period_next_round(pool):
    """owner_a misses round 1 (autopicked) — their round 2 pick (snake
    order puts it right after owner_b's round-1 AND round-2 picks, the
    4th pick overall) should get the short grace window instead of the
    normal 60s, since their last pick was an autopick."""
    owner_a, owner_b = await _setup_two_team_draft(pool)
    await _seed_player(pool, "grace-a1")  # for owner_a's autopick
    player_b1 = await _seed_player(pool, "grace-b1")
    player_b2 = await _seed_player(pool, "grace-b2")

    async with pool.acquire() as conn:
        await draft_engine.autopick(conn, TEST_SEASON)  # owner_a's round-1 pick
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player_b1)  # owner_b round 1
        result = await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player_b2)  # owner_b round 2

    config = result["config"]
    assert config["current_pick_number"] == 4  # owner_a's round-2 pick
    remaining = (config["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()
    assert 0 <= remaining <= 5


async def test_manually_picked_owner_gets_normal_timer_next_round(pool):
    """Contrast case for the grace-period test above — owner_a picks
    for themself in round 1 (no autopick involved), so their round-2
    pick should get the normal 60s, not the grace window."""
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player_a1 = await _seed_player(pool, "normal-a1")
    player_b1 = await _seed_player(pool, "normal-b1")
    player_b2 = await _seed_player(pool, "normal-b2")

    async with pool.acquire() as conn:
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player_a1)  # owner_a round 1, live pick
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player_b1)  # owner_b round 1
        result = await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player_b2)  # owner_b round 2

    config = result["config"]
    assert config["current_pick_number"] == 4  # owner_a's round-2 pick
    remaining = (config["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()
    assert 55 <= remaining <= 60


async def test_concurrent_picks_only_one_succeeds(pool):
    """Two near-simultaneous make_pick calls for the SAME pick slot
    (both claiming to be owner_a, who's actually on the clock) racing
    against each other — the draft_config FOR UPDATE lock must
    serialize them so only one player ends up drafted, not two."""
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player_1 = await _seed_player(pool, "7a")
    player_2 = await _seed_player(pool, "7b")

    async def _try_pick(player):
        async with pool.acquire() as conn:
            try:
                return await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)
            except Exception as e:
                return e

    results = await asyncio.gather(_try_pick(player_1), _try_pick(player_2))
    successes = [r for r in results if isinstance(r, dict)]
    assert len(successes) == 1


async def test_undo_last_pick_reverses_pick_and_roster(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "8")

    async with pool.acquire() as conn:
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)
        result = await draft_engine.undo_last_pick(conn, TEST_SEASON)

    assert result["undone_pick"]["sleeper_player_id"] == player
    assert result["config"]["current_pick_number"] == 1

    async with pool.acquire() as conn:
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_a
        )
        roster_row = await conn.fetchval(
            "SELECT count(*) FROM current_rosters WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )
        pick_row = await conn.fetchrow(
            "SELECT sleeper_player_id, made_at FROM draft_picks WHERE season = $1 AND pick_number = 1", TEST_SEASON
        )
    assert roster_row == 0
    assert pick_row["sleeper_player_id"] is None
    assert pick_row["made_at"] is None


async def test_undo_last_pick_raises_when_nothing_to_undo(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    async with pool.acquire() as conn:
        try:
            await draft_engine.undo_last_pick(conn, TEST_SEASON)
            assert False, "expected NothingToUndoError"
        except NothingToUndoError:
            pass


async def test_seed_keeper_pick_is_skipped_by_live_turn_advancement(pool):
    """Owner B's round-1 pick is pre-filled as a keeper before the draft
    starts — once owner A picks in round 1, the live turn should skip
    straight past owner B's already-filled round-1 slot to round 2
    (which, in a 2-team snake draft, is owner B again)."""
    owner_a, _ = await _seed_owner_and_team(pool, "ka")
    owner_b, _ = await _seed_owner_and_team(pool, "kb")
    keeper_player = await _seed_player(pool, "keeper1")
    live_player = await _seed_player(pool, "live1")

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        await draft_engine.seed_keeper_pick(conn, TEST_SEASON, owner_b, round_num=1, sleeper_player_id=keeper_player)
        config = await draft_engine.start_draft(conn, TEST_SEASON)

    # Owner A is still first on the clock (owner B's pick 2 is already filled).
    assert config["current_pick_number"] == 1

    async with pool.acquire() as conn:
        result = await draft_engine.make_pick(conn, TEST_SEASON, owner_a, live_player)

    # Pick 2 (owner_b, round 1, pre-filled keeper) is skipped; next open
    # pick is pick 3 (round 2, owner_b again in a 2-team snake).
    assert result["config"]["current_pick_number"] == 3
    async with pool.acquire() as conn:
        next_pick = await conn.fetchrow(
            "SELECT owner_id, is_keeper FROM draft_picks WHERE season = $1 AND pick_number = 3", TEST_SEASON
        )
    assert next_pick["owner_id"] == owner_b
    assert next_pick["is_keeper"] is False


async def test_draft_completes_when_all_picks_made(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "ca")
    owner_b, _ = await _seed_owner_and_team(pool, "cb")
    tiny_slots = {"QB": 1, "BE": 0}
    players = [await _seed_player(pool, f"c{i}", position="QB", search_rank=i) for i in range(1, 5)]

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], tiny_slots)
        await draft_engine.start_draft(conn, TEST_SEASON)

    turns = [owner_a, owner_b]  # round 1 order for 2 teams, 1 round total
    async with pool.acquire() as conn:
        result = None
        for i, owner in enumerate(turns):
            result = await draft_engine.make_pick(conn, TEST_SEASON, owner, players[i])

    assert result["config"]["status"] == "complete"
    assert result["config"]["completed_at"] is not None


async def test_create_draft_refuses_to_overwrite_existing_config(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "dup_a")
    owner_b, _ = await _seed_owner_and_team(pool, "dup_b")

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        try:
            await draft_engine.create_draft(conn, TEST_SEASON, [owner_b, owner_a], _ROSTER_SLOTS)
            assert False, "expected DraftAlreadyExistsError"
        except DraftAlreadyExistsError:
            pass


async def test_create_draft_stores_and_round_trips_position_max(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "posmax_a")
    owner_b, _ = await _seed_owner_and_team(pool, "posmax_b")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(
            conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS, position_max={"QB": 4, "RB": 8}
        )
        config = await conn.fetchrow("SELECT position_max FROM draft_config WHERE season = $1", TEST_SEASON)
    assert json.loads(config["position_max"]) == {"QB": 4, "RB": 8}


async def test_create_draft_position_max_defaults_to_none(pool):
    """No position_max passed at all — every existing league/season that
    never touches this new setting keeps behaving exactly as before
    (draft_autopick.py's physical-only guardrail), not a NULL-handling
    crash."""
    owner_a, _ = await _seed_owner_and_team(pool, "posmax_none_a")
    owner_b, _ = await _seed_owner_and_team(pool, "posmax_none_b")
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        config = await conn.fetchrow("SELECT position_max FROM draft_config WHERE season = $1", TEST_SEASON)
    assert config["position_max"] is None


async def test_autopick_respects_a_configured_position_max(pool):
    """End-to-end version of test_draft_autopick.py's own unit test —
    real create_draft -> real autopick, not just choose_autopick called
    directly. owner_a already has 1 RB rostered (round 1); with RB
    capped at 1, a much-better-ranked 2nd RB in the pool gets skipped
    for a worse-ranked WR on owner_a's round-2 autopick.

    autopick() queries every real is_draftable player in the actual
    `players` table (11,000+ real rows, real search ranks as low as 1
    — this suite runs against a live-data-seeded DB, not a blank one),
    so every rank here is negative: the only way to guarantee these 5
    test players are the sole real contenders for "best available"
    regardless of what real production data happens to be seeded."""
    owner_a, _ = await _seed_owner_and_team(pool, "posmax_ap_a")
    owner_b, _ = await _seed_owner_and_team(pool, "posmax_ap_b")
    rb1 = await _seed_player(pool, "posmax-rb1", position="RB", search_rank=-5)
    player_b1 = await _seed_player(pool, "posmax-b1", position="WR", search_rank=-4)
    player_b2 = await _seed_player(pool, "posmax-b2", position="WR", search_rank=-3)
    rb2 = await _seed_player(pool, "posmax-rb2", position="RB", search_rank=-2)  # better rank, but RB is capped
    wr1 = await _seed_player(pool, "posmax-wr1", position="WR", search_rank=-1)

    async with pool.acquire() as conn:
        await draft_engine.create_draft(
            conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS, position_max={"RB": 1}
        )
        await draft_engine.start_draft(conn, TEST_SEASON)
        await draft_engine.autopick(conn, TEST_SEASON)  # owner_a round 1 -> best overall, rb1
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player_b1)  # owner_b round 1
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, player_b2)  # owner_b round 2
        result = await draft_engine.autopick(conn, TEST_SEASON)  # owner_a round 2

    assert result["pick"]["sleeper_player_id"] == wr1  # not rb2, despite its better rank


async def test_reset_draft_clears_config_picks_and_rosters(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)
    player = await _seed_player(pool, "reset1")

    async with pool.acquire() as conn:
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, player)
        await draft_engine.reset_draft(conn, TEST_SEASON)

        config = await conn.fetchval("SELECT count(*) FROM draft_config WHERE season = $1", TEST_SEASON)
        picks = await conn.fetchval("SELECT count(*) FROM draft_picks WHERE season = $1", TEST_SEASON)
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_a
        )
        rosters = await conn.fetchval(
            "SELECT count(*) FROM current_rosters WHERE season = $1 AND team_id = $2", TEST_SEASON, team_id
        )

    assert config == 0
    assert picks == 0
    assert rosters == 0


async def test_reset_then_create_draft_with_a_new_order_succeeds(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)

    async with pool.acquire() as conn:
        await draft_engine.reset_draft(conn, TEST_SEASON)
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_b, owner_a], _ROSTER_SLOTS)
        config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1", TEST_SEASON)

    assert config["draft_order"] == [owner_b, owner_a]
    assert config["status"] == "not_started"


async def test_reset_draft_is_a_noop_when_nothing_exists(pool):
    async with pool.acquire() as conn:
        await draft_engine.reset_draft(conn, TEST_SEASON)  # must not raise


# ---- seed_keepers_from_locked_selections -------------------------------

async def _seed_keeper_rules(pool, locked=True, max_keepers=1):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO league_keeper_rules (season, max_keepers, locked_at)
            VALUES ($1, $2, NULL)
            ON CONFLICT (season, league_id) DO UPDATE SET max_keepers = EXCLUDED.max_keepers, locked_at = NULL
            """,
            TEST_SEASON, max_keepers,
        )
        if locked:
            await conn.execute(
                "UPDATE league_keeper_rules SET locked_at = now() WHERE season = $1", TEST_SEASON
            )


async def _seed_keeper_selection(pool, owner_id, espn_player_id, player_name):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name)
            VALUES ($1, $2, $3, $4)
            """,
            TEST_SEASON, owner_id, espn_player_id, player_name,
        )


async def test_seed_keepers_seeds_last_round_for_every_locked_selection(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "ska")
    owner_b, _ = await _seed_owner_and_team(pool, "skb")
    sleeper_a = await _seed_player(pool, "ska-keeper", espn_player_id=910001)
    sleeper_b = await _seed_player(pool, "skb-keeper", espn_player_id=910002)
    await _seed_keeper_rules(pool, locked=True)
    await _seed_keeper_selection(pool, owner_a, 910001, "Keeper A")
    await _seed_keeper_selection(pool, owner_b, 910002, "Keeper B")

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        seeded = await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)

    last_round = draft_engine.total_draftable_slots(_ROSTER_SLOTS)
    assert {s["owner_id"] for s in seeded} == {owner_a, owner_b}
    assert all(s["round"] == last_round for s in seeded)

    async with pool.acquire() as conn:
        picks = await conn.fetch(
            "SELECT owner_id, sleeper_player_id, is_keeper FROM draft_picks "
            "WHERE season = $1 AND round = $2 ORDER BY owner_id",
            TEST_SEASON, last_round,
        )
    picks_by_owner = {p["owner_id"]: p for p in picks}
    assert picks_by_owner[owner_a]["sleeper_player_id"] == sleeper_a
    assert picks_by_owner[owner_a]["is_keeper"] is True
    assert picks_by_owner[owner_b]["sleeper_player_id"] == sleeper_b


async def test_seed_keepers_is_idempotent_and_only_seeds_new_owners(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "ika")
    owner_b, _ = await _seed_owner_and_team(pool, "ikb")
    await _seed_player(pool, "ika-keeper", espn_player_id=910011)
    await _seed_player(pool, "ikb-keeper", espn_player_id=910012)
    await _seed_keeper_rules(pool, locked=True)
    await _seed_keeper_selection(pool, owner_a, 910011, "Keeper A")

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        first_pass = await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)
    assert len(first_pass) == 1

    # A straggler owner's selection gets locked in later — re-running
    # must not error (no duplicate current_rosters insert for owner_a).
    await _seed_keeper_selection(pool, owner_b, 910012, "Keeper B")
    async with pool.acquire() as conn:
        second_pass = await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)

    assert len(second_pass) == 1
    assert second_pass[0]["owner_id"] == owner_b


async def test_seed_keepers_raises_when_rules_not_locked(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "nla")
    await _seed_keeper_rules(pool, locked=False)
    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a], _ROSTER_SLOTS)
        try:
            await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)
            assert False, "expected KeeperSelectionsNotLockedError"
        except KeeperSelectionsNotLockedError:
            pass


async def test_seed_keepers_raises_and_reports_every_unresolved_selection(pool):
    owner_a, _ = await _seed_owner_and_team(pool, "ura")
    owner_b, _ = await _seed_owner_and_team(pool, "urb")
    await _seed_keeper_rules(pool, locked=True)
    # Neither espn_player_id has a matching players row.
    await _seed_keeper_selection(pool, owner_a, 920001, "Unresolved A")
    await _seed_keeper_selection(pool, owner_b, 920002, "Unresolved B")

    async with pool.acquire() as conn:
        await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
        try:
            await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)
            assert False, "expected KeeperResolutionError"
        except KeeperResolutionError as e:
            assert {u["espn_player_id"] for u in e.unresolved} == {920001, 920002}

    # Nothing was seeded — all-or-nothing.
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM draft_picks WHERE season = $1 AND is_keeper = TRUE", TEST_SEASON
        )
    assert count == 0


async def test_seed_keepers_raises_once_draft_has_started(pool):
    owner_a, owner_b = await _setup_two_team_draft(pool)  # already started
    await _seed_keeper_rules(pool, locked=True)
    async with pool.acquire() as conn:
        try:
            await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)
            assert False, "expected DraftNotInProgressError"
        except DraftNotInProgressError:
            pass


async def test_seed_keepers_raises_when_no_draft_configured(pool):
    await _seed_keeper_rules(pool, locked=True)
    async with pool.acquire() as conn:
        try:
            await draft_engine.seed_keepers_from_locked_selections(conn, TEST_SEASON)
            assert False, "expected DraftNotFoundError"
        except DraftNotFoundError:
            pass
