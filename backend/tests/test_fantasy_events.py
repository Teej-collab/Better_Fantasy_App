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
    assert "took the lead" in by_owner[owner_away]["title"].lower()
    assert "20.0–10.0" in by_owner[owner_away]["body"]
    assert "lost" in by_owner[owner_home]["title"].lower()
    assert by_owner[owner_home]["url"] == "/matchups/1"


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


def test_every_formatter_payload_carries_its_url_inside_data():
    # The service worker and the native tap handler both read the
    # destination from data.url — a payload with only a top-level url
    # used to open the homepage on tap.
    from app.notifications import formatter

    payloads = [
        formatter.test_notification(),
        formatter.chat_direct_message("A", "hi", 5),
        formatter.chat_mention("A", "hi", 5),
        formatter.draft_on_the_clock(1, 3, 90),
        formatter.chug_posted("A", 8.5, True),
        formatter.fantasy_player_touchdown("P", "Team", "rush_td", 6.0, 12, on_bench=False, tag="t"),
        formatter.fantasy_red_zone("KC", ["P"], 12),
        formatter.fantasy_matchup_lead_change(True, "Them", 80.0, 70.0, 12),
    ]
    for p in payloads:
        assert p["data"]["url"] == p["url"]
        assert p["url"].startswith("/") and p["url"] != "/"


def test_touchdown_copy_names_the_kind_points_and_matchup():
    from app.notifications import formatter

    p = formatter.fantasy_player_touchdown("D. Henry", "Dime Package", "rush_td", 6.1, 42, on_bench=False, tag="td-1")
    assert "D. Henry" in p["title"]
    assert "Rushing TD" in p["body"] and "+6.1 pts" in p["body"]
    assert p["url"] == "/matchups/42"

    bench = formatter.fantasy_player_touchdown("D. Henry", "Dime Package", "rush_td", 6.1, 42, on_bench=True, tag="td-1")
    assert "bench" in bench["title"].lower()

    no_matchup = formatter.fantasy_player_touchdown("X", "T", None, None, None, on_bench=False, tag="td-2")
    assert no_matchup["url"] == "/team"


def test_red_zone_entries_fires_once_per_entry_with_a_cooldown():
    fantasy_events._reset_red_zone_state_for_tests()
    live_rz = [{"state": "in", "is_redzone": True, "possession_team_abbr": "KC"}]
    out = [{"state": "in", "is_redzone": False, "possession_team_abbr": "KC"}]

    assert fantasy_events.red_zone_entries(live_rz, now=0) == ["KC"]
    # Still in the red zone next tick — no repeat.
    assert fantasy_events.red_zone_entries(live_rz, now=20) == []
    # Leaves and comes back within the cooldown (a sack, a penalty) — no repeat.
    assert fantasy_events.red_zone_entries(out, now=40) == []
    assert fantasy_events.red_zone_entries(live_rz, now=60) == []
    # A later drive, past the cooldown — fires again.
    assert fantasy_events.red_zone_entries(out, now=600) == []
    assert fantasy_events.red_zone_entries(live_rz, now=620) == ["KC"]
    fantasy_events._reset_red_zone_state_for_tests()


async def test_notify_red_zone_only_names_starters_and_respects_the_preference(pool, monkeypatch):
    fantasy_events._reset_red_zone_state_for_tests()
    owner_on, team_on = await _seed_owner_and_team(pool, "rz-on", 700007)
    owner_off, team_off = await _seed_owner_and_team(pool, "rz-off", 700008)
    await _seed_player(pool, "test-fe-rz-starter", "RB")
    await _seed_player(pool, "test-fe-rz-bench", "WR")
    await _seed_player(pool, "test-fe-rz-other", "TE")
    async with pool.acquire() as conn:
        await conn.executemany(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, $4, 'draft')",
            [
                (TEST_SEASON, team_on, "test-fe-rz-starter", "RB"),
                (TEST_SEASON, team_on, "test-fe-rz-bench", "BE"),
                (TEST_SEASON, team_off, "test-fe-rz-other", "TE"),
            ],
        )
        await preferences_queries.update_preferences(conn, owner_on, {"push_enabled": True, "notify_red_zone": True})
        await preferences_queries.update_preferences(conn, owner_off, {"push_enabled": True, "notify_red_zone": False})

    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(fantasy_events.dispatcher, "send_to_owner", _fake_send_to_owner)

    games = [{"state": "in", "is_redzone": True, "possession_team_abbr": "KC"}]
    async with pool.acquire() as conn:
        await fantasy_events.notify_red_zone(conn, TEST_SEASON, None, games)

    mine = [p for owner, p in sent if owner == owner_on]
    assert len(mine) == 1
    assert "Test Player test-fe-rz-starter" in mine[0]["body"]
    assert "test-fe-rz-bench" not in mine[0]["body"]
    assert mine[0]["data"]["type"] == "fantasy_red_zone"
    assert all(owner != owner_off for owner, _ in sent)
    fantasy_events._reset_red_zone_state_for_tests()
