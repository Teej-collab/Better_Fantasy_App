"""Tests for app/domain/manager_awards.py — The Great White Buffalo and
Manager of the Year."""
import itertools

from app.domain import manager_awards
from app.domain.manager_awards import (
    GREAT_WHITE_BUFFALO,
    MANAGER_OF_THE_YEAR,
    buffalo_moments,
    comeback_score,
    manager_scores,
)
from app.domain.season_awards import determine_and_save_season_awards
from tests.conftest import TEST_SEASON


def _row(week, team, player, started=True, points=0):
    return {"week": week, "team_id": team, "player_id": player, "started": started, "points": points}


def test_only_big_started_games_count_against_whoever_let_him_go():
    rows = [
        _row(1, 1, "p"), _row(2, 2, "p", points=24), _row(3, 2, "p", points=9),
        _row(4, 2, "p", started=False, points=30),
    ]
    assert buffalo_moments(rows) == [{"week": 2, "player_id": "p", "from_team": 1, "to_team": 2, "points": 24.0}]


def test_blame_moves_to_the_most_recent_manager_to_let_him_go():
    # A drops him, B picks him up and drops him, C has him when he booms.
    rows = [_row(1, "A", "p"), _row(2, "B", "p"), _row(4, "C", "p", points=31)]
    assert [m["from_team"] for m in buffalo_moments(rows)] == ["B"]
    # A takes him back: nothing counts against A anymore.
    rows = [_row(1, "A", "p"), _row(2, "B", "p"), _row(3, "A", "p", points=20)]
    assert [m["from_team"] for m in buffalo_moments(rows)] == ["B"]


def test_a_player_never_moved_never_counts():
    assert buffalo_moments([_row(w, 1, "p", points=40) for w in range(1, 6)]) == []


def test_a_mid_week_drop_shows_on_both_teams_and_the_new_one_holds_him():
    rows = [_row(1, 1, "p"), _row(2, 1, "p", points=2), _row(2, 2, "p", started=False), _row(3, 2, "p", points=18)]
    assert buffalo_moments(rows) == [{"week": 3, "player_id": "p", "from_team": 1, "to_team": 2, "points": 18.0}]


def test_comeback_needs_a_hole_so_a_hot_start_earns_nothing():
    assert comeback_score([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 1, 1]) == 0
    # 1-4 to 8-6: five games back, capped at twice the depth (6).
    assert comeback_score([-1, 0, -1, -2, -3, -2, -1, 0, 1, 0, 1, 2, 1, 2], []) == 5
    # 0-1 then a run: capped at 2 games.
    assert comeback_score([-1, 0, 1, 2, 3, 4], []) == 2
    # Power rank 11th to 4th adds half the climb.
    assert comeback_score([], [9, 11, 8, 4]) == 3.5


def test_no_single_part_wins_it_alone():
    parts = {
        "champ": {"comeback": 0, "moves": 10, "adversity": 0, "bench_crimes": 5},
        "grinder": {"comeback": 5, "moves": 300, "adversity": 200, "bench_crimes": 20},
        "lucky": {"comeback": 1, "moves": 50, "adversity": 10, "bench_crimes": 0},
    }
    scores = manager_scores(parts)
    assert max(scores, key=scores.get) == "grinder"
    assert scores["grinder"] == 90.0  # tops three parts (85), last in lineup calls (15 × 1/3)


_ids = itertools.count(970001)


async def _seed(pool):
    """Four teams, five regular-season weeks plus a decided title game.
    Team 0 starts 0-3 and wins out on the back of a pickup; team 1
    drops that pickup in Week 1 and wins the first three."""
    async with pool.acquire() as conn:
        owners, teams = [], []
        for i in range(4):
            owner = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-mgr-award-{i}", f"Manager {i}",
            )
            team = await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) "
                "RETURNING id",
                TEST_SEASON, next(_ids), owner, f"Team {i}",
            )
            owners.append(owner)
            teams.append(team)
        for pid, name in (("test-buffalo", "Buffalo Bill"), ("test-filler", "Filler Guy")):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position) VALUES ($1, $2, 'WR') "
                "ON CONFLICT (sleeper_player_id) DO NOTHING",
                pid, name,
            )
        for week in range(1, 6):
            t0_wins = week > 3
            await conn.execute(
                "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                TEST_SEASON, week, teams[0], teams[1], 120 if t0_wins else 90, 100,
            )
            await conn.execute(
                "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
                "VALUES ($1, $2, $3, $4, 110, 95)",
                TEST_SEASON, week, teams[2], teams[3],
            )
            holder = teams[1] if week == 1 else teams[0]
            await conn.execute(
                "INSERT INTO roster_history (season, week, team_id, sleeper_player_id, lineup_slot, points_projected) "
                "VALUES ($1, $2, $3, 'test-buffalo', 'WR', 10)",
                TEST_SEASON, week, holder,
            )
            await conn.execute(
                "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points, league_id) "
                "VALUES ($1, $2, 'test-buffalo', '{\"rec\": 6}', $3, 1)",
                TEST_SEASON, week, 5 if week == 1 else 22,
            )
        await conn.execute(
            "INSERT INTO playoff_bracket_matchups (season, league_id, round, slot, code, bracket, winner_team_id) "
            "VALUES ($1, 1, 1, 1, 'F', 'winners', $2)",
            TEST_SEASON, teams[2],
        )
    return owners, teams


async def test_both_awards_land_in_season_awards(pool):
    owners, _ = await _seed(pool)
    async with pool.acquire() as conn:
        await determine_and_save_season_awards(conn, TEST_SEASON, 1)
        rows = {
            r["award_type"]: r for r in await conn.fetch(
                "SELECT award_type, owner_id, detail FROM season_awards WHERE season = $1 AND league_id = 1",
                TEST_SEASON,
            )
        }
    assert rows[GREAT_WHITE_BUFFALO]["owner_id"] == owners[1]
    assert rows[GREAT_WHITE_BUFFALO]["detail"] == "gave away 88 pts in big games, all Buffalo Bill"
    assert rows[MANAGER_OF_THE_YEAR]["owner_id"] == owners[0]
    assert "climbed from 3 games under .500" in rows[MANAGER_OF_THE_YEAR]["detail"]


async def test_manager_of_the_year_waits_for_the_title_game(pool):
    await _seed(pool)
    async with pool.acquire() as conn:
        await conn.execute("UPDATE playoff_bracket_matchups SET winner_team_id = NULL WHERE season = $1", TEST_SEASON)
        assert await manager_awards.manager_of_the_year(conn, TEST_SEASON, 1) is None


async def test_the_recap_calls_out_the_week_he_burned_his_old_team(pool):
    await _seed(pool)
    async with pool.acquire() as conn:
        facts = await manager_awards.buffalo_facts(conn, TEST_SEASON, 4, 1, lambda name: name.replace("Team", "Mgr"))
    assert facts == [
        "Great White Buffalo watch (the one that got away): Mgr 1 let Buffalo Bill go, and he scored 22.0 for "
        "Mgr 0, against Mgr 1"
    ]
