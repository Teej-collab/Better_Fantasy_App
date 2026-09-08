from app.domain.schedule import generate_regular_season_schedule, generate_round_robin_pairings
from app.domain.schedule_exceptions import NotEnoughTeamsError, ScheduleAlreadyExistsError
from tests.conftest import TEST_SEASON


def test_round_robin_rejects_fewer_than_two_teams():
    try:
        generate_round_robin_pairings([1], 5)
        assert False, "expected NotEnoughTeamsError"
    except NotEnoughTeamsError:
        pass


def test_round_robin_single_cycle_every_team_plays_every_other_exactly_once():
    teams = [1, 2, 3, 4]
    schedule = generate_round_robin_pairings(teams, weeks=3)  # n-1 = 3 weeks = one full cycle

    played_pairs = set()
    for week, home, away in schedule:
        played_pairs.add(frozenset((home, away)))
    all_expected_pairs = {frozenset((a, b)) for i, a in enumerate(teams) for b in teams[i + 1:]}
    assert played_pairs == all_expected_pairs


def test_round_robin_each_team_plays_exactly_once_per_week():
    teams = [1, 2, 3, 4, 5, 6]
    schedule = generate_round_robin_pairings(teams, weeks=5)  # n-1 = 5, one full cycle, even count

    by_week: dict[int, list[int]] = {}
    for week, home, away in schedule:
        by_week.setdefault(week, []).extend([home, away])
    for week, teams_playing in by_week.items():
        assert len(teams_playing) == len(set(teams_playing)), f"week {week} double-books a team"
        assert len(teams_playing) == len(teams)  # even count -> nobody sits out


def test_round_robin_odd_team_count_gives_one_bye_per_week():
    teams = [1, 2, 3, 4, 5]  # odd -> a bye placeholder is added internally
    schedule = generate_round_robin_pairings(teams, weeks=5)

    by_week: dict[int, list[int]] = {}
    for week, home, away in schedule:
        by_week.setdefault(week, []).extend([home, away])
        assert home in teams and away in teams  # never a placeholder/None in real output
    for week, teams_playing in by_week.items():
        assert len(teams_playing) == len(set(teams_playing))
        assert len(teams_playing) == len(teams) - 1  # one team byes every week


def test_round_robin_repeats_the_cycle_with_flipped_home_away_for_extra_weeks():
    teams = [1, 2, 3, 4]
    schedule = generate_round_robin_pairings(teams, weeks=6)  # 2 full cycles (3 weeks each)

    first_cycle = {(min(h, a), max(h, a)): (h, a) for _, h, a in schedule[:6]}
    second_cycle = {(min(h, a), max(h, a)): (h, a) for _, h, a in schedule[6:]}
    assert set(first_cycle.keys()) == set(second_cycle.keys())
    # Every repeated pairing has home/away swapped the second time around.
    for pair_key, (home1, away1) in first_cycle.items():
        home2, away2 = second_cycle[pair_key]
        assert (home1, away1) == (away2, home2)


def test_round_robin_partial_weeks_just_truncates():
    teams = [1, 2, 3, 4]
    schedule = generate_round_robin_pairings(teams, weeks=2)  # less than a full cycle (3)
    weeks_present = {week for week, _, _ in schedule}
    assert weeks_present == {1, 2}
    assert len(schedule) == 4  # 2 weeks x 2 games each


async def _seed_team(pool, suffix, espn_team_id):
    from app.config import DEFAULT_LEAGUE_ID

    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-schedgen-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}", DEFAULT_LEAGUE_ID,
        )
    return team_id


async def test_generate_regular_season_schedule_writes_real_matchups(pool):
    from app.config import DEFAULT_LEAGUE_ID

    team_ids = [await _seed_team(pool, i, 500 + i) for i in range(4)]

    async with pool.acquire() as conn:
        created = await generate_regular_season_schedule(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, weeks=3)
        rows = await conn.fetch(
            "SELECT week, home_team_id, away_team_id, is_playoff FROM matchups WHERE season = $1", TEST_SEASON
        )

    assert len(created) == 6  # 3 weeks x 2 games
    assert len(rows) == 6
    assert all(r["is_playoff"] is False for r in rows)
    assert {r["home_team_id"] for r in rows} | {r["away_team_id"] for r in rows} == set(team_ids)


async def test_generate_regular_season_schedule_rejects_if_already_scheduled(pool):
    from app.config import DEFAULT_LEAGUE_ID

    await _seed_team(pool, "a", 510)
    await _seed_team(pool, "b", 511)

    async with pool.acquire() as conn:
        await generate_regular_season_schedule(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, weeks=1)
        try:
            await generate_regular_season_schedule(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, weeks=1)
            assert False, "expected ScheduleAlreadyExistsError"
        except ScheduleAlreadyExistsError:
            pass
