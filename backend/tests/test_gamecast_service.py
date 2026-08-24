"""
Fantasy-impact diffing (app/gamecast/service.py) — the one piece of
Gamecast that touches the DB. This deliberately does NOT seed a second
season anywhere (see conftest.py's TEST_SEASON comment): every owner/
team/roster row here lives under TEST_SEASON only, exactly like
tests/test_records.py and friends.
"""
from app.gamecast import service
from app.gamecast.models import GameStatus, LiveGame, TeamRef
from tests.conftest import TEST_SEASON

from datetime import datetime, timezone


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-gamecast-owner-{suffix}", f"Owner {suffix}",
        )


async def _seed_team(pool, owner_id, suffix, season=TEST_SEASON):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 500 + suffix, owner_id, f"Team {suffix}",
        )


async def _seed_roster_player(pool, team_id, week, player_name, pro_team, points_scored, season=TEST_SEASON):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, "
            "points_scored, points_projected, pro_team) "
            "VALUES ($1, $2, $3, $4, 'WR', 'WR', $5, $5, $6)",
            season, week, team_id, player_name, points_scored, pro_team,
        )


async def _seed_league_state(pool, week, season=TEST_SEASON):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, $2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            season, week,
        )


def _fake_game(game_id="test-gamecast-game", home="KC", away="BUF"):
    now = datetime.now(timezone.utc)
    return LiveGame(
        game_id=game_id,
        provider="mock",
        status=GameStatus.IN_PROGRESS,
        season=TEST_SEASON,
        week=1,
        scheduled_start=now,
        home_team=TeamRef(abbr=home, name="Kansas City Chiefs", score=7),
        away_team=TeamRef(abbr=away, name="Buffalo Bills", score=0),
        last_updated=now,
    )


async def test_diff_fantasy_impact_emits_nothing_on_first_poll_but_deltas_on_the_next(pool, monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    owner_id = await _seed_owner(pool, 1)
    team_id = await _seed_team(pool, owner_id, 1)
    await _seed_league_state(pool, week=1)
    await _seed_roster_player(pool, team_id, week=1, player_name="Mahomes", pro_team="KC", points_scored=6.0)

    game = _fake_game()
    service._last_points.pop(game.game_id, None)  # isolate from any other test's state

    async with pool.acquire() as conn:
        first_events = await service._diff_fantasy_impact(conn, game)
        assert first_events == []  # no prior baseline yet — nothing to diff against

        async with pool.acquire() as conn2:
            await conn2.execute(
                "UPDATE rosters SET points_scored = 12.5 WHERE season = $1 AND team_id = $2 AND player_name = 'Mahomes'",
                TEST_SEASON, team_id,
            )
        second_events = await service._diff_fantasy_impact(conn, game)

    assert len(second_events) == 1
    event = second_events[0]
    assert event["type"] == "fantasy_impact"
    assert event["player_name"] == "Mahomes"
    assert event["pro_team"] == "KC"
    assert event["owner_id"] == owner_id
    assert event["team_name"] == "Team 1"
    assert event["points_scored"] == 12.5
    assert event["delta"] == 6.5

    service._last_points.pop(game.game_id, None)


async def test_diff_fantasy_impact_ignores_players_on_pro_teams_not_in_this_game(pool, monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    owner_id = await _seed_owner(pool, 2)
    team_id = await _seed_team(pool, owner_id, 2)
    await _seed_league_state(pool, week=1)
    # Rostered player is on SF, but the game being diffed is KC @ BUF.
    await _seed_roster_player(pool, team_id, week=1, player_name="Purdy", pro_team="SF", points_scored=3.0)

    game = _fake_game()
    service._last_points.pop(game.game_id, None)

    async with pool.acquire() as conn:
        await service._diff_fantasy_impact(conn, game)
        async with pool.acquire() as conn2:
            await conn2.execute(
                "UPDATE rosters SET points_scored = 20.0 WHERE season = $1 AND team_id = $2 AND player_name = 'Purdy'",
                TEST_SEASON, team_id,
            )
        events = await service._diff_fantasy_impact(conn, game)

    assert events == []
    service._last_points.pop(game.game_id, None)


async def test_diff_fantasy_impact_returns_empty_when_no_sync_has_cached_a_current_week(pool, monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    # Deliberately no league_state row seeded for TEST_SEASON.

    game = _fake_game(game_id="test-gamecast-no-week")
    async with pool.acquire() as conn:
        events = await service._diff_fantasy_impact(conn, game)

    assert events == []
