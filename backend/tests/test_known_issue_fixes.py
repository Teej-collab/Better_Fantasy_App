"""Fixes for the Logic Bible's "Known issues" list (2026-09-24): chaos
score on in-app seasons, Game of the Week frozen to pre-week ranks,
win probability counting a finished player's real points, and ties
counting as half a win. The chug-settlement and trade-deadline fixes
are tested alongside their own features (test_chug_standing.py,
test_trades.py)."""
from app.domain.live_projection import live_team_total
from app.domain.streaks import compute_streak
from app.domain.team_profile import find_game_of_the_week
from app.domain.weekly_awards import _team_clutch_choke
from app.domain.weekly_team_stats import compute_chaos_scores_for_week, compute_power_ranks
from app.queries.league import get_standings
from tests.conftest import TEST_SEASON


_ESPN_ID_BASE = {"stand": 700, "gotw": 710, "chaos": 720}


async def _seed_teams(pool, prefix, count):
    team_ids = []
    async with pool.acquire() as conn:
        for i in range(count):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-knownfix-{prefix}-{i}", f"Owner {prefix} {i}",
            )
            team_ids.append(await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) "
                "VALUES ($1, $2, $3, $4) RETURNING id",
                TEST_SEASON, _ESPN_ID_BASE[prefix] + i, owner_id, f"{prefix} team {i}",
            ))
    return team_ids


# --- Ties count as half a win ---------------------------------------------

def test_streak_is_broken_by_a_tie():
    assert compute_streak([True, True, True]) == "hot"
    assert compute_streak([False, False, False]) == "cold"
    assert compute_streak([False, None, False]) == "neutral"  # used to read as cold
    assert compute_streak([True, True, None]) == "neutral"


def test_a_tie_is_neither_clutch_nor_choke():
    # Would be a choke (lost as a 20-point favorite) if the tie counted as a loss.
    assert _team_clutch_choke(100.0, False, 130.0, 110.0, tied=True) is None
    assert _team_clutch_choke(100.0, False, 130.0, 110.0)["label"] == "choke"


def test_power_rank_win_pct_input_accepts_half_wins():
    ranks = compute_power_ranks([
        {"team_id": 1, "win_pct": 0.5, "avg_points": 100, "recent_form": 100},  # 1-1
        {"team_id": 2, "win_pct": 0.75, "avg_points": 100, "recent_form": 100},  # 1-0-1
        {"team_id": 3, "win_pct": 0.25, "avg_points": 100, "recent_form": 100},  # 0-1-1
    ])
    assert ranks == {2: 1, 1: 2, 3: 3}


async def test_standings_rank_a_tie_as_half_a_win(pool):
    a, b, c, d = await _seed_teams(pool, "stand", 4)
    async with pool.acquire() as conn:
        # A: 1-1 with more points.  B: 1-0-1 with fewer points.
        for week, home, away, hs, as_ in [
            (1, a, c, 200, 90), (2, a, d, 90, 95),
            (1, b, d, 100, 99), (2, b, c, 80, 80),
        ]:
            await conn.execute(
                "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
                "VALUES ($1, $2, $3, $4, $5, $6, FALSE)",
                TEST_SEASON, week, home, away, hs, as_,
            )
        order = [r["team_id"] for r in await get_standings(conn, TEST_SEASON)]
    # Wins alone tie A and B at 1, and A's points would win it; B's
    # half-win from the tie puts B first.
    assert order.index(b) < order.index(a)


# --- Win probability ---------------------------------------------------------

def _starter(pro_team, scored, projected, slot="WR", position="WR", player_id="p"):
    return {
        "lineup_slot": slot, "pro_team": pro_team, "points_scored": scored, "points_projected": projected,
        "position": position, "player_id": player_id,
    }


def test_win_probability_total_counts_a_finished_dud_at_its_real_score():
    # Win probability now runs off live projections (test_live_projection.py
    # covers the math); the original issue — a finished 2-point game on a
    # 15-point projection still counting 15 — stays fixed.
    roster = [
        _starter("IND", 2, 15),                 # game over: counts 2
        _starter("SF", None, 12),               # not started: 12
        _starter("DAL", 30, 10, slot="BE"),     # bench never counts
    ]
    clock = {"IND": {"status": "final", "share_left": 0.0}, "SF": {"status": "scheduled", "share_left": 1.0}}
    assert live_team_total(roster, clock) == 2 + 12


# --- Game of the Week --------------------------------------------------------

async def test_game_of_the_week_uses_ranks_from_before_that_week(pool):
    t1, t2, t3, t4 = await _seed_teams(pool, "gotw", 4)
    async with pool.acquire() as conn:
        # Going into week 2: t1 & t2 are the top two.
        for team, rank in [(t1, 1), (t2, 2), (t3, 3), (t4, 4)]:
            await conn.execute(
                "INSERT INTO weekly_team_stats (season, week, team_id, power_rank) VALUES ($1, 1, $2, $3)",
                TEST_SEASON, team, rank,
            )
        # After week 2 finishes, t3 & t4 jump to the top.
        for team, rank in [(t3, 1), (t4, 2), (t1, 3), (t2, 4)]:
            await conn.execute(
                "INSERT INTO weekly_team_stats (season, week, team_id, power_rank) VALUES ($1, 2, $2, $3)",
                TEST_SEASON, team, rank,
            )
        matchups = [
            {"home_team_id": t1, "away_team_id": t2},
            {"home_team_id": t3, "away_team_id": t4},
        ]
        week2 = await find_game_of_the_week(conn, TEST_SEASON, 2, matchups)
        week3 = await find_game_of_the_week(conn, TEST_SEASON, 3, matchups)
        week1 = await find_game_of_the_week(conn, TEST_SEASON, 1, matchups)

    assert week2["home_team_id"] == t1  # week 2 keeps the pick it had while being played
    assert week3["home_team_id"] == t3  # week 3 goes into the week with the new ranks
    assert week1 is None  # nobody is ranked before week 1


# --- Chaos score -------------------------------------------------------------

async def test_chaos_score_reads_roster_history_for_in_app_seasons(pool):
    (team_id,) = await _seed_teams(pool, "chaos", 1)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO draft_config (season, draft_order, roster_slots) VALUES ($1, '{}', '{}')", TEST_SEASON,
        )
        for i, (slot, boom, bust) in enumerate([
            ("RB", True, False), ("WR", False, True), ("TE", False, False), ("QB", False, False),
            ("BE", True, False),  # bench booms don't count
        ]):
            sleeper_id = f"test-knownfix-chaos-{i}"
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable) VALUES ($1, $2, 'RB', TRUE)",
                sleeper_id, f"Chaos Player {i}",
            )
            await conn.execute(
                "INSERT INTO roster_history (season, week, team_id, sleeper_player_id, lineup_slot, is_boom, is_bust) "
                "VALUES ($1, 1, $2, $3, $4, $5, $6)",
                TEST_SEASON, team_id, sleeper_id, slot, boom, bust,
            )

        assert await compute_chaos_scores_for_week(conn, TEST_SEASON, 1) == 1
        chaos = await conn.fetchval(
            "SELECT chaos_score FROM weekly_team_stats WHERE season = $1 AND week = 1 AND team_id = $2",
            TEST_SEASON, team_id,
        )
    assert float(chaos) == 50.0  # 1 boom + 1 bust out of 4 starters
