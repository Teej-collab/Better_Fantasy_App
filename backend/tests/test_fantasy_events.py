"""Tests for app/notifications/fantasy_events.py — the diff logic
(_leader) is pure and unit-tested directly; snapshot_week/
notify_fantasy_events are tested against real seeded rows, with
dispatcher.send_to_owner patched (same pattern test_chat.py's push
tests use) so nothing tries to reach a real push provider."""
from app.notifications import fantasy_events
from app.queries import owner_preferences as preferences_queries
from tests.conftest import TEST_SEASON


def test_leader_reports_the_higher_score():
    assert fantasy_events._leader(20.0, 10.0) == "home"
    assert fantasy_events._leader(10.0, 20.0) == "away"


def test_leader_is_none_when_tied_or_not_started():
    assert fantasy_events._leader(0.0, 0.0) is None
    assert fantasy_events._leader(14.0, 14.0) is None
    assert fantasy_events._leader(None, None) is None
    assert fantasy_events._leader(10.0, None) is None


async def _seed_owner_and_team(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-fantasyevents-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def _seed_player(pool, sleeper_id, position="WR"):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE)
            """,
            sleeper_id, f"Test Player {sleeper_id}", position, [position],
        )


async def _set_player_week_stats(pool, sleeper_id, week, raw_stats_json):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, $2, $3, $4, 0)",
            TEST_SEASON, week, sleeper_id, raw_stats_json,
        )


async def test_snapshot_week_sums_all_three_touchdown_categories(pool):
    await _seed_player(pool, "test-fe-scorer1")
    await _set_player_week_stats(pool, "test-fe-scorer1", 1, '{"rush_td": 1, "rec_td": 2, "pass_td": 1}')

    async with pool.acquire() as conn:
        snap = await fantasy_events.snapshot_week(conn, TEST_SEASON, 1)

    assert snap["player_tds"]["test-fe-scorer1"] == 4.0


async def test_notify_touchdowns_pushes_every_owner_who_rosters_the_scorer(pool, monkeypatch):
    owner_a, team_a = await _seed_owner_and_team(pool, "td-a", 700001)
    await _seed_player(pool, "test-fe-td1")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'WR', 'draft')",
            TEST_SEASON, team_a, "test-fe-td1",
        )
        await preferences_queries.update_preferences(conn, owner_a, {"push_enabled": True, "notify_my_players": True})

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(fantasy_events.dispatcher, "send_to_owner", _fake_send_to_owner)

    before = {"player_tds": {"test-fe-td1": 0.0}, "matchups": {}}
    after = {"player_tds": {"test-fe-td1": 1.0}, "matchups": {}}

    async with pool.acquire() as conn:
        await fantasy_events.notify_fantasy_events(conn, TEST_SEASON, before, after)

    assert len(sent) == 1
    notified_owner_id, payload = sent[0]
    assert notified_owner_id == owner_a
    assert payload["data"]["type"] == "fantasy_player_touchdown"


async def test_notify_touchdowns_skips_an_owner_with_the_preference_off(pool, monkeypatch):
    owner_a, team_a = await _seed_owner_and_team(pool, "td-off", 700002)
    await _seed_player(pool, "test-fe-td2")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'WR', 'draft')",
            TEST_SEASON, team_a, "test-fe-td2",
        )
        await preferences_queries.update_preferences(
            conn, owner_a, {"push_enabled": True, "notify_my_players": False}
        )

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(fantasy_events.dispatcher, "send_to_owner", _fake_send_to_owner)

    before = {"player_tds": {"test-fe-td2": 0.0}, "matchups": {}}
    after = {"player_tds": {"test-fe-td2": 1.0}, "matchups": {}}

    async with pool.acquire() as conn:
        await fantasy_events.notify_fantasy_events(conn, TEST_SEASON, before, after)

    assert sent == []


async def test_notify_lead_change_pushes_both_owners_on_a_real_flip(pool, monkeypatch):
    owner_home, team_home = await _seed_owner_and_team(pool, "lead-home", 700003)
    owner_away, team_away = await _seed_owner_and_team(pool, "lead-away", 700004)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(
            conn, owner_home, {"push_enabled": True, "notify_fantasy_team": True}
        )
        await preferences_queries.update_preferences(
            conn, owner_away, {"push_enabled": True, "notify_fantasy_team": True}
        )

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(fantasy_events.dispatcher, "send_to_owner", _fake_send_to_owner)

    matchup = {"home_team_id": team_home, "away_team_id": team_away, "home_score": 10.0, "away_score": 20.0}
    before = {"player_tds": {}, "matchups": {1: {**matchup, "home_score": 20.0, "away_score": 10.0}}}  # home was leading
    after = {"player_tds": {}, "matchups": {1: matchup}}  # away just took the lead

    async with pool.acquire() as conn:
        await fantasy_events.notify_fantasy_events(conn, TEST_SEASON, before, after)

    assert len(sent) == 2
    by_owner = dict(sent)
    assert by_owner[owner_away]["data"]["type"] == "fantasy_matchup_lead_change"
    assert "took the lead" in by_owner[owner_away]["title"].lower() or "lead" in by_owner[owner_away]["title"].lower()
    assert "lost" in by_owner[owner_home]["title"].lower() or "lead" in by_owner[owner_home]["title"].lower()


async def test_notify_lead_change_is_a_noop_when_the_leader_is_unchanged(pool, monkeypatch):
    owner_home, team_home = await _seed_owner_and_team(pool, "lead-same-home", 700005)
    owner_away, team_away = await _seed_owner_and_team(pool, "lead-same-away", 700006)
    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(
            conn, owner_home, {"push_enabled": True, "notify_fantasy_team": True}
        )
        await preferences_queries.update_preferences(
            conn, owner_away, {"push_enabled": True, "notify_fantasy_team": True}
        )

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(fantasy_events.dispatcher, "send_to_owner", _fake_send_to_owner)

    before_matchup = {"home_team_id": team_home, "away_team_id": team_away, "home_score": 10.0, "away_score": 3.0}
    after_matchup = {"home_team_id": team_home, "away_team_id": team_away, "home_score": 17.0, "away_score": 3.0}
    before = {"player_tds": {}, "matchups": {1: before_matchup}}
    after = {"player_tds": {}, "matchups": {1: after_matchup}}  # home still leading, just by more

    async with pool.acquire() as conn:
        await fantasy_events.notify_fantasy_events(conn, TEST_SEASON, before, after)

    assert sent == []
