"""Tests for app/notifications/injury_events.py — feed parsing and the
change classifier are pure; run_injury_watch and
notify_in_game_injuries run against real seeded rows with
dispatcher.send_to_owner patched, same pattern as
tests/test_fantasy_events.py."""
import datetime

from app.notifications import injury_events
from app.queries import owner_preferences as preferences_queries
from tests.conftest import TEST_SEASON

NOW = datetime.datetime(2026, 9, 27, 18, 0, tzinfo=datetime.timezone.utc)


def _entry(espn_id, status, news_id="n1", hours_ago=1, detail="Blurb.", injury="Hamstring"):
    return {
        "id": news_id,
        "status": status,
        "date": (NOW - datetime.timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%MZ"),
        "shortComment": detail,
        "details": {"type": injury},
        "athlete": {"links": [{"href": f"https://www.espn.com/nfl/player/_/id/{espn_id}/someone"}]},
    }


def _feed(*entries):
    return {"injuries": [{"injuries": list(entries)}]}


def _parsed(status, news_id="n1", hours_ago=1, detail="Blurb."):
    return injury_events.parse_injury_feed(_feed(_entry(1, status, news_id, hours_ago, detail)))[0]


def test_parse_injury_feed_reads_status_injury_and_espn_id_from_link():
    [item] = injury_events.parse_injury_feed(_feed(_entry(4242, "Questionable")))
    assert item["espn_player_id"] == 4242
    assert item["status"] == "Questionable"
    assert item["injury"] == "Hamstring"
    assert item["news_at"] == NOW - datetime.timedelta(hours=1)


def test_parse_injury_feed_keeps_the_newest_entry_per_player():
    items = injury_events.parse_injury_feed(
        _feed(_entry(7, "Out", "old", hours_ago=5), _entry(7, "Questionable", "new", hours_ago=1))
    )
    assert [i["news_id"] for i in items] == ["new"]


def test_classify_status_changes():
    q, out, active, dbt = _parsed("Questionable"), _parsed("Out"), _parsed("Active"), _parsed("Doubtful")
    assert injury_events.classify(q, out, NOW) == ("injury", "downgrade")
    assert injury_events.classify(out, dbt, NOW) == ("injury", "upgrade")
    assert injury_events.classify(q, active, NOW) == ("injury", "cleared")
    assert injury_events.classify(active, q, NOW) == ("injury", "new")
    assert injury_events.classify(_parsed("Out"), _parsed("Injured Reserve"), NOW) == ("injury", "downgrade")


def test_classify_news_needs_a_newer_blurb():
    prev = _parsed("Questionable", news_id="a", hours_ago=5)
    assert injury_events.classify(prev, _parsed("Questionable", news_id="b", hours_ago=1), NOW) == ("news", "")
    assert injury_events.classify(prev, _parsed("Questionable", news_id="a", hours_ago=5), NOW) is None
    # ESPN re-serving an older blurb isn't news.
    assert injury_events.classify(prev, _parsed("Questionable", news_id="c", hours_ago=9), NOW) is None


def test_classify_first_sighting_only_if_recent():
    assert injury_events.classify(None, _parsed("Out", hours_ago=2), NOW) == ("injury", "new")
    assert injury_events.classify(None, _parsed("Out", hours_ago=48), NOW) is None
    assert injury_events.classify(None, _parsed("Active", hours_ago=2), NOW) == ("news", "")


async def _seed(pool, suffix, espn_team_id, sleeper_id, espn_player_id, slot="BE"):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-injury-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status,
                                 is_draftable, espn_player_id)
            VALUES ($1, $2, 'WR', ARRAY['WR'], 'KC', 'Active', TRUE, $3)
            """,
            sleeper_id, f"Test Player {sleeper_id}", espn_player_id,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, $4, 'draft')",
            TEST_SEASON, team_id, sleeper_id, slot,
        )
        await preferences_queries.update_preferences(conn, owner_id, {"push_enabled": True})
    return owner_id, team_id


def _capture(monkeypatch):
    sent = []

    async def _fake_send_to_owner(conn, owner_id, payload, now=None):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(injury_events.dispatcher, "send_to_owner", _fake_send_to_owner)
    return sent


async def _clear_watch_state(pool):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM player_injury_status WHERE sleeper_player_id LIKE 'test-%'")


# Each DB test runs the watch twice: the first run only establishes the
# "before" state (it may be a silent seeding run if the table is empty),
# and the second is the diff under test.


async def test_watch_pushes_a_downgrade_to_the_owner_even_on_the_bench(pool, monkeypatch):
    owner_id, _ = await _seed(pool, "down", 710001, "test-inj-1", 990000001, slot="BE")
    sent = _capture(monkeypatch)
    await _clear_watch_state(pool)

    async with pool.acquire() as conn:
        await injury_events.run_injury_watch(conn, TEST_SEASON, _feed(_entry(990000001, "Questionable", "a", 5)), now=NOW)
        sent.clear()
        result = await injury_events.run_injury_watch(
            conn, TEST_SEASON, _feed(_entry(990000001, "Out", "b", 1, "Ruled out Sunday.")), now=NOW,
        )
        stored = await conn.fetchval("SELECT status FROM player_injury_status WHERE sleeper_player_id = 'test-inj-1'")

    assert stored == "Out"
    assert result["alerts"] == 1
    assert len(sent) == 1
    assert sent[0][0] == owner_id
    assert sent[0][1]["title"] == "⬇️ Test Player test-inj-1 downgraded to Out (hamstring)"
    assert sent[0][1]["data"]["type"] == "injury_update"


async def test_watch_respects_the_news_and_injury_toggles(pool, monkeypatch):
    owner_id, _ = await _seed(pool, "toggles", 710003, "test-inj-2", 990000003)
    sent = _capture(monkeypatch)
    await _clear_watch_state(pool)

    async with pool.acquire() as conn:
        await injury_events.run_injury_watch(conn, TEST_SEASON, _feed(_entry(990000003, "Questionable", "a", 5)), now=NOW)
        await preferences_queries.update_preferences(conn, owner_id, {"notify_player_news": False})
        sent.clear()
        await injury_events.run_injury_watch(conn, TEST_SEASON, _feed(_entry(990000003, "Questionable", "b", 1)), now=NOW)
        assert sent == []

        await preferences_queries.update_preferences(conn, owner_id, {"notify_player_news": True})
        await injury_events.run_injury_watch(conn, TEST_SEASON, _feed(_entry(990000003, "Questionable", "c", 0)), now=NOW)

    assert [p["data"]["type"] for _, p in sent] == ["player_news"]


async def test_in_game_injury_pushes_once_per_new_state(pool, monkeypatch):
    owner_id, _ = await _seed(pool, "ingame", 710004, "test-inj-3", 990000004, slot="WR")
    sent = _capture(monkeypatch)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO live_injury_status (season, week, sleeper_player_id, state, source, event_at) "
            "VALUES ($1, 3, 'test-inj-3', 'left', 'play', now())",
            TEST_SEASON,
        )
        await injury_events.notify_in_game_injuries(conn, TEST_SEASON, 3)
        await injury_events.notify_in_game_injuries(conn, TEST_SEASON, 3)
        await conn.execute(
            "UPDATE live_injury_status SET state = 'ruled_out' WHERE season = $1 AND sleeper_player_id = 'test-inj-3'",
            TEST_SEASON,
        )
        await injury_events.notify_in_game_injuries(conn, TEST_SEASON, 3)

    assert [p["title"] for _, p in sent] == [
        "🩹 Test Player test-inj-3 left the game",
        "❌ Test Player test-inj-3 ruled out",
    ]
    assert all(oid == owner_id for oid, _ in sent)
