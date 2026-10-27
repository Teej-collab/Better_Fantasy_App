"""Tests for app/domain/schedule_builder.py — fair by construction, the
marquee games where they belong, and the automatic release after a
draft."""
import collections
import itertools

from app.domain import schedule_builder
from app.domain.schedule_builder import (
    OPENER,
    RIVALRY_WEEK,
    TITLE_REMATCH,
    build_schedule,
    rivalry_week_for,
)
from tests.conftest import TEST_SEASON

TEAMS = list(range(1, 13))
RIVALRIES = [(1, 2), (3, 4), (5, 6), (7, 8), (2, 9)]


def _build(**kwargs):
    defaults = dict(
        teams=TEAMS, weeks=14, champion=1, favorite=5, rivalries=RIVALRIES, title_pair=(1, 10),
        contenders=[5, 7, 9, 11], seed=7,
    )
    return build_schedule(**{**defaults, **kwargs})


def test_fair_every_team_plays_every_week_and_everyone_once_per_cycle():
    games, _ = _build()
    by_week = collections.defaultdict(list)
    for week, home, away in games:
        by_week[week].append((home, away))
    assert sorted(by_week) == list(range(1, 15))
    for week_games in by_week.values():
        teams = [t for g in week_games for t in g]
        assert sorted(teams) == TEAMS  # everyone plays, once
    first_cycle = {frozenset(g) for w, *g in games if w <= 11}
    assert first_cycle == {frozenset(p) for p in itertools.combinations(TEAMS, 2)}


def test_home_and_away_stay_within_a_game_of_even_and_nobody_plays_back_to_back():
    games, _ = _build()
    homes = collections.Counter(home for _, home, _ in games)
    assert max(homes.values()) - min(homes.values()) <= 2
    seen = {}
    for week, home, away in sorted(games):
        pair = frozenset((home, away))
        assert seen.get(pair) != week - 1
        seen[pair] = week


def test_marquee_games_land_where_they_belong():
    games, headlines = _build()
    by_label = collections.defaultdict(list)
    for (week, home, away), label in headlines.items():
        by_label[label].append((week, frozenset((home, away))))
    assert by_label[OPENER] == [(1, frozenset((1, 5)))]
    rivalry_week = rivalry_week_for(14)
    assert {w for w, _ in by_label[RIVALRY_WEEK]} == {rivalry_week}
    assert len(by_label[RIVALRY_WEEK]) >= 3  # a full round of rivalries, as many as fit
    (title_week, title_pair), = by_label[TITLE_REMATCH]
    assert title_pair == frozenset((1, 10)) and 14 / 3 <= title_week <= 28 / 3


def test_same_league_and_season_always_get_the_same_schedule():
    assert _build() == _build()
    assert _build()[0] != _build(seed=8)[0]


def test_odd_team_count_gets_byes_and_no_rivalries_means_no_rivalry_week():
    games, headlines = build_schedule(list(range(1, 10)), 13, seed=1)
    played = collections.Counter([g[1] for g in games] + [g[2] for g in games])
    assert set(played) == set(range(1, 10)) and max(played.values()) - min(played.values()) <= 2
    assert RIVALRY_WEEK not in headlines.values()


async def _seed_league(pool, league_id_offset: int = 0):
    """12 teams in the default league for TEST_SEASON, a champion from
    the season before, draft grades, and one rivalry."""
    async with pool.acquire() as conn:
        owners, teams = [], []
        for i in range(12):
            owner = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-sched-{league_id_offset}-{i}", f"Owner {i}",
            )
            team = await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
                TEST_SEASON, 940000 + league_id_offset * 100 + i, owner, f"Team {i}",
            )
            owners.append(owner)
            teams.append(team)
            await conn.execute(
                "INSERT INTO draft_grades (season, league_id, owner_id, total_projected_points, league_avg_projected_points, "
                "value_score, percentile, letter_grade) VALUES ($1, 1, $2, 100, 100, $3, 50, 'C')",
                TEST_SEASON, owner, float(100 - i),
            )
        await conn.execute(
            "INSERT INTO season_champions (season, owner_id, team_name, league_id) VALUES ($1, $2, 'Champs', 1)",
            TEST_SEASON - 1, owners[11],
        )
        await conn.execute(
            "INSERT INTO rivalries (owner_a_id, owner_b_id, name, tier, league_id) VALUES ($1, $2, 'Test Feud', 'Historic', 1)",
            owners[3], owners[4],
        )
    return owners, teams


async def test_release_after_draft_writes_the_schedule_with_headlines(pool):
    owners, teams = await _seed_league(pool)
    async with pool.acquire() as conn:
        assert await schedule_builder.release_after_draft(conn, TEST_SEASON, 1)
        rows = await conn.fetch(
            "SELECT week, home_team_id, away_team_id, headline FROM matchups "
            "WHERE season = $1 AND league_id = 1 AND is_playoff = FALSE",
            TEST_SEASON,
        )
        # Already scheduled: a second release does nothing.
        assert not await schedule_builder.release_after_draft(conn, TEST_SEASON, 1)

    assert len(rows) == 14 * 6
    opener = [r for r in rows if r["headline"] == OPENER]
    # Champion (owner 11) vs the favorite (owner 0, best draft value).
    assert len(opener) == 1 and opener[0]["week"] == 1
    assert {opener[0]["home_team_id"], opener[0]["away_team_id"]} == {teams[11], teams[0]}
    rivalry = [r for r in rows if r["headline"] == RIVALRY_WEEK]
    assert {(r["home_team_id"], r["away_team_id"]) for r in rivalry} in (
        {(teams[3], teams[4])}, {(teams[4], teams[3])}
    )
    assert rivalry[0]["week"] == rivalry_week_for(14)


async def test_release_after_draft_skips_a_mirrored_league(pool, monkeypatch):
    await _seed_league(pool, 1)

    async def mirrored(conn, league_id):
        return "espn"

    monkeypatch.setattr(schedule_builder, "mirror_platform", mirrored)
    async with pool.acquire() as conn:
        assert not await schedule_builder.release_after_draft(conn, TEST_SEASON, 1)
        assert not await conn.fetchval("SELECT 1 FROM matchups WHERE season = $1 AND league_id = 1", TEST_SEASON)
