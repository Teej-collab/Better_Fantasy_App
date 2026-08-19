from app.providers.espn.adapter import ESPNProvider
from tests.conftest import TEST_SEASON
from tests.fakes_espn import (
    FakeLeague,
    make_fake_box_score,
    make_fake_matchup,
    make_fake_player,
    make_fake_team,
)


async def test_sync_teams_upserts_owners_and_teams(pool, espn_config, monkeypatch):
    fake_teams = [
        make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith"),
        make_fake_team(2, "Team Two", "test-member-2", "Bob", "Jones"),
    ]
    fake_league = FakeLeague(teams=fake_teams)
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    count = await provider.sync_teams(pool, TEST_SEASON)
    assert count == 2

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT team_name FROM teams_by_season WHERE season = $1 ORDER BY team_name",
            TEST_SEASON,
        )
    assert [r["team_name"] for r in rows] == ["Team One", "Team Two"]

    # Re-run with a renamed team — should update in place, not duplicate.
    fake_teams[0].team_name = "Team One Renamed"
    count2 = await provider.sync_teams(pool, TEST_SEASON)
    assert count2 == 2

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT team_name FROM teams_by_season WHERE season = $1 ORDER BY team_name",
            TEST_SEASON,
        )
    names = [r["team_name"] for r in rows]
    assert names == ["Team One Renamed", "Team Two"]


async def test_sync_matchups_saves_and_skips_bye_week(pool, espn_config, monkeypatch):
    fake_teams = [
        make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith"),
        make_fake_team(2, "Team Two", "test-member-2", "Bob", "Jones"),
        make_fake_team(3, "Team Three", "test-member-3", "Carl", "Davis"),
    ]
    week1_matchups = [
        make_fake_matchup(1, 2, 100.5, 90.25),
        make_fake_matchup(3, 0, 80.0, 0),  # bye week — should be skipped
    ]
    fake_league = FakeLeague(
        teams=fake_teams,
        reg_season_count=13,
        scoreboard_by_week={1: week1_matchups},
    )
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    await provider.sync_teams(pool, TEST_SEASON)
    saved = await provider.sync_matchups(pool, TEST_SEASON)

    assert saved == 1  # only the real matchup, not the bye

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT home_score, away_score, is_playoff FROM matchups WHERE season = $1",
            TEST_SEASON,
        )
    assert len(rows) == 1
    assert float(rows[0]["home_score"]) == 100.5
    assert float(rows[0]["away_score"]) == 90.25
    assert rows[0]["is_playoff"] is False


async def test_sync_final_standings_saves_only_when_season_complete(pool, espn_config, monkeypatch):
    fake_teams = [
        make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith", final_standing=2),
        make_fake_team(2, "Team Two", "test-member-2", "Bob", "Jones", final_standing=1),
    ]
    fake_league = FakeLeague(teams=fake_teams)
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    await provider.sync_teams(pool, TEST_SEASON)
    saved = await provider.sync_final_standings(pool, TEST_SEASON)
    assert saved == 2

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT t.team_name, fs.final_rank FROM final_standings fs "
            "JOIN teams_by_season t ON t.id = fs.team_id "
            "WHERE fs.season = $1 ORDER BY fs.final_rank",
            TEST_SEASON,
        )
    assert [(r["team_name"], r["final_rank"]) for r in rows] == [
        ("Team Two", 1), ("Team One", 2),
    ]


async def test_sync_final_standings_skips_in_progress_season(pool, espn_config, monkeypatch):
    fake_teams = [
        make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith"),  # final_standing=0 default
        make_fake_team(2, "Team Two", "test-member-2", "Bob", "Jones"),
    ]
    fake_league = FakeLeague(teams=fake_teams)
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    await provider.sync_teams(pool, TEST_SEASON)
    saved = await provider.sync_final_standings(pool, TEST_SEASON)
    assert saved == 0

    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM final_standings WHERE season = $1", TEST_SEASON
        )
    assert count == 0


async def test_sync_rosters_saves_and_replaces_on_rerun(pool, espn_config, monkeypatch):
    fake_teams = [
        make_fake_team(1, "Team One", "test-member-1", "Alice", "Smith"),
        make_fake_team(2, "Team Two", "test-member-2", "Bob", "Jones"),
    ]
    week1_players_home = [make_fake_player("Player A", "RB", "RB", 12.5, 10.0)]
    week1_players_away = [make_fake_player("Player B", "WR", "WR", 8.0, 7.5)]
    box_scores_week1 = [
        make_fake_box_score(1, 2, week1_players_home, week1_players_away),
    ]
    fake_league = FakeLeague(
        teams=fake_teams,
        box_scores_by_week={1: box_scores_week1},
    )
    monkeypatch.setattr("app.providers.espn.adapter.League", lambda **kwargs: fake_league)

    provider = ESPNProvider(espn_config)
    await provider.sync_teams(pool, TEST_SEASON)
    saved_weeks = await provider.sync_rosters(pool, TEST_SEASON)
    assert saved_weeks == 1

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT player_name FROM rosters WHERE season = $1 ORDER BY player_name",
            TEST_SEASON,
        )
    assert [r["player_name"] for r in rows] == ["Player A", "Player B"]

    # Re-run with a different lineup — old rows for that team/week should be
    # replaced, not appended (per adapter's delete-then-insert behavior).
    box_scores_week1[0] = make_fake_box_score(
        1, 2,
        [make_fake_player("Player C", "QB", "QB", 20.0, 18.0)],
        week1_players_away,
    )
    saved_weeks2 = await provider.sync_rosters(pool, TEST_SEASON)
    assert saved_weeks2 == 1

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT player_name FROM rosters WHERE season = $1 ORDER BY player_name",
            TEST_SEASON,
        )
    assert [r["player_name"] for r in rows] == ["Player B", "Player C"]
