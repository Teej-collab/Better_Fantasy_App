import json
from datetime import datetime, timedelta, timezone

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
from app.routers.commissioner_lineup import _waiver_locked_pro_teams as commissioner_waiver_locked_pro_teams
from app.routers.me import _locked_pro_teams_for_current_week as me_locked_pro_teams
from app.routers.me import _waiver_locked_pro_teams as me_waiver_locked_pro_teams
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


async def test_dropped_player_waiver_clock_is_one_day(pool):
    """This league's real ESPN setting: a player a team actually drops
    is on waivers for 1 day. The 2026-09-22 change had applied the
    Wednesday-3am-ET clear to drops too, so every player dropped in
    Wednesday morning's own waiver run was stranded for a full week."""
    import datetime as dt

    player = await _seed_player(pool, "drop-one-day")
    before = dt.datetime.now(dt.timezone.utc)
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        clears_at = (await waivers.get_waiver_clears_at(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, [player]))[player]
    after = dt.datetime.now(dt.timezone.utc)
    assert before + dt.timedelta(days=1) <= clears_at <= after + dt.timedelta(days=1)


async def test_game_locked_waiver_clock_clears_at_next_wednesday_3am_et(pool):
    """Real 2026-09-22 correction, quoting ESPN's own rules text:
    "Waivers process daily between 3 a.m. and 5 a.m. ET, with the main
    weekly run happening Tuesday night into Wednesday morning" — a
    free agent locked by their game kicking off clears at the SAME
    fixed weekly instant (3:00 AM ET every Wednesday), not a rolling
    N-hours-after-kickoff timer."""
    import datetime as dt
    import zoneinfo

    et = zoneinfo.ZoneInfo("America/New_York")
    player = await _seed_player(pool, "wed-clear")
    async with pool.acquire() as conn:
        await waivers.ensure_waiver_clock_if_game_locked(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player, frozenset({"KC"})
        )
        clears_at = (await waivers.get_waiver_clears_at(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, [player]))[player]

    clears_at_et = clears_at.astimezone(et)
    assert clears_at_et.weekday() == 2  # Wednesday
    assert (clears_at_et.hour, clears_at_et.minute, clears_at_et.second) == (3, 0, 0)
    assert clears_at > dt.datetime.now(dt.timezone.utc)


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


async def test_ensure_waiver_clock_if_game_locked_noop_when_team_not_locked(pool):
    # _seed_player always seeds pro_team='KC' — an empty/non-matching
    # locked set must never start a real clock just because someone
    # looked at this player.
    player = await _seed_player(pool, "locked-noop")
    async with pool.acquire() as conn:
        await waivers.ensure_waiver_clock_if_game_locked(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player, frozenset()
        )
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is False

        await waivers.ensure_waiver_clock_if_game_locked(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player, frozenset({"BUF"})
        )
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is False


async def test_ensure_waiver_clock_if_game_locked_starts_clock_for_locked_team(pool):
    player = await _seed_player(pool, "locked-start")
    async with pool.acquire() as conn:
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is False
        await waivers.ensure_waiver_clock_if_game_locked(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player, frozenset({"KC"})
        )
        assert await waivers.is_on_waivers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player) is True


async def test_ensure_waiver_clock_if_game_locked_does_not_reset_an_existing_clock(pool):
    # start_waiver_clock's own upsert resets clears_at on every call
    # (ON CONFLICT DO UPDATE) — this helper must guard against that by
    # checking is_on_waivers first, or every repeated add/claim attempt
    # on an already-waived, still-locked player would keep pushing
    # their real clear time out indefinitely.
    player = await _seed_player(pool, "locked-idempotent")
    async with pool.acquire() as conn:
        await waivers.start_waiver_clock(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player)
        clears_at_map = await waivers.get_waiver_clears_at(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, [player])
        first_clears_at = clears_at_map[player]

        await waivers.ensure_waiver_clock_if_game_locked(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player, frozenset({"KC"})
        )
        clears_at_map = await waivers.get_waiver_clears_at(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, [player])
        assert clears_at_map[player] == first_clears_at


async def _seed_current_week(pool, week):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, $2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON, week,
        )


async def test_lineup_lock_never_falls_back_to_prior_week(pool, monkeypatch):
    """Real 2026-09-23 bug: the week-rollover fallback (meant only for
    waiver gating) also fed the lineup lock, so every team that played
    in the week that just ended read as "game already started" and
    nobody could move a single player for the new week."""
    await _seed_current_week(pool, week=6)

    async def fake_week_scoreboard(week, year, season_type=2):
        assert week == 6, "the lineup lock must only ever read the current week"
        return [{"date": "2099-01-01T17:00:00Z", "home_team": "SF", "away_team": "SEA"}]

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", fake_week_scoreboard)

    async with pool.acquire() as conn:
        assert await me_locked_pro_teams(conn, TEST_SEASON) == frozenset()


async def test_waiver_lock_falls_back_to_prior_week_until_its_wednesday_clear(pool, monkeypatch):
    """Real 2026-09-22 bug: league_state.current_week advances the
    instant a week's games all go Final, so right after Monday Night
    Football the new week's schedule has nothing kicked off — players
    from the week that just ended must stay waiver-gated until their
    own Wednesday-3am-ET clear."""
    await _seed_current_week(pool, week=6)
    just_kicked_off = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

    async def fake_week_scoreboard(week, year, season_type=2):
        if week == 6:  # new week hasn't kicked off yet
            return [{"date": "2099-01-01T17:00:00Z", "home_team": "SF", "away_team": "SEA"}]
        assert week == 5  # the week that just settled
        return [{"date": just_kicked_off, "home_team": "KC", "away_team": "BUF"}]

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", fake_week_scoreboard)
    monkeypatch.setattr("app.routers.commissioner_lineup.get_week_scoreboard", fake_week_scoreboard)

    async with pool.acquire() as conn:
        assert await me_waiver_locked_pro_teams(conn, TEST_SEASON) == frozenset({"KC", "BUF"})
        assert await commissioner_waiver_locked_pro_teams(conn, TEST_SEASON) == frozenset({"KC", "BUF"})


async def test_waiver_lock_prior_week_fallback_ends_at_wednesday_clear(pool, monkeypatch):
    await _seed_current_week(pool, week=6)

    async def fake_week_scoreboard(week, year, season_type=2):
        if week == 6:
            return [{"date": "2099-01-01T17:00:00Z", "home_team": "SF", "away_team": "SEA"}]
        return [{"date": "2020-01-01T17:00:00Z", "home_team": "KC", "away_team": "BUF"}]  # long since cleared

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", fake_week_scoreboard)

    async with pool.acquire() as conn:
        assert await me_waiver_locked_pro_teams(conn, TEST_SEASON) == frozenset()


def test_waiver_locked_pro_teams_real_week_2_to_3_rollover():
    # Week 2's last game: MNF, Mon 2026-09-21 8:15pm ET. Week 3 opens Thu 2026-09-24.
    prior = [
        {"date": "2026-09-20T17:00:00Z", "home_team": "KC", "away_team": "BUF"},
        {"date": "2026-09-22T00:15:00Z", "home_team": "DAL", "away_team": "NYG"},
    ]
    current = [{"date": "2026-09-25T00:15:00Z", "home_team": "SF", "away_team": "SEA"}]
    tuesday_night = datetime(2026, 9, 23, 3, 0, tzinfo=timezone.utc)  # Tue 11pm ET
    just_before_clear = datetime(2026, 9, 23, 6, 59, tzinfo=timezone.utc)  # Wed 2:59am ET
    at_clear = datetime(2026, 9, 23, 7, 0, tzinfo=timezone.utc)  # Wed 3:00am ET
    wednesday_morning = datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc)
    thursday_kickoff = datetime(2026, 9, 25, 0, 20, tzinfo=timezone.utc)

    all_prior = frozenset({"KC", "BUF", "DAL", "NYG"})
    assert waivers.waiver_locked_pro_teams(current, prior, tuesday_night) == all_prior
    assert waivers.waiver_locked_pro_teams(current, prior, just_before_clear) == all_prior
    assert waivers.waiver_locked_pro_teams(current, prior, at_clear) == frozenset()
    assert waivers.waiver_locked_pro_teams(current, prior, wednesday_morning) == frozenset()
    assert waivers.waiver_locked_pro_teams(current, prior, thursday_kickoff) == frozenset({"SF", "SEA"})


async def test_waiver_lock_prefers_current_week_once_its_own_games_start(pool, monkeypatch):
    await _seed_current_week(pool, week=6)

    async def fake_week_scoreboard(week, year, season_type=2):
        if week == 6:  # this week's own games have now started
            return [{"date": "2020-01-01T17:00:00Z", "home_team": "SF", "away_team": "SEA"}]
        raise AssertionError("should not fall back to the prior week once the current week has locked teams")

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", fake_week_scoreboard)

    async with pool.acquire() as conn:
        assert await me_waiver_locked_pro_teams(conn, TEST_SEASON) == frozenset({"SF", "SEA"})


async def test_waiver_lock_does_not_fall_back_before_week_one(pool, monkeypatch):
    await _seed_current_week(pool, week=1)

    async def fake_week_scoreboard(week, year, season_type=2):
        assert week == 1  # never asks for a "week 0"
        return [{"date": "2099-09-10T17:00:00Z", "home_team": "SF", "away_team": "SEA"}]  # not kicked off yet

    monkeypatch.setattr("app.routers.me.get_week_scoreboard", fake_week_scoreboard)

    async with pool.acquire() as conn:
        assert await me_waiver_locked_pro_teams(conn, TEST_SEASON) == frozenset()


async def test_submit_claim_allowed_on_locked_never_dropped_player(pool):
    # The whole point of this feature: a player who was never actually
    # dropped by anyone (no real waiver_wire row) but whose game just
    # kicked off must still be claimable, not rejected outright by
    # submit_claim's own is_on_waivers gate — that's what the router
    # calling ensure_waiver_clock_if_game_locked immediately beforehand
    # is for.
    await _seed_roster_config(pool)
    _, team_id = await _seed_owner_with_team(pool, "locked-claim", espn_team_id=217)
    player = await _seed_player(pool, "locked-claim")
    async with pool.acquire() as conn:
        await waivers.ensure_waiver_clock_if_game_locked(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, player, frozenset({"KC"})
        )
        claim = await waivers.submit_claim(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, team_id, player)
    assert claim["status"] == "pending"
    assert claim["add_sleeper_player_id"] == player
