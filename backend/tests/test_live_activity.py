"""Lock-screen / Dynamic Island live score (app/domain/live_activity.py)."""
import json

import pytest

from app.domain import live_activity
from app.notifications import apns_client
from app.queries import live_activities as queries
from tests.conftest import TEST_SEASON
from tests.test_chat import _SESSION_SECRET, _client, _seed_owner, _session_cookie


def _week(matchup_id=7, started=True, in_play=1, yet=2, my=50.0, opp=40.0):
    return {
        "week": 6,
        "team_name": "Gridiron Gang",
        "matchup": {
            "matchup_id": matchup_id,
            "started": started,
            "my_yet_to_play": yet,
            "my_in_play": in_play,
            "opponent_yet_to_play": 0,
            "opponent_in_play": 0,
            "my_score": my,
            "opponent_score": opp,
            "my_projected_total": 110.0,
            "opponent_projected_total": 95.0,
            "opponent_team_name": "Mile High Club",
            "win_probability": 71.6,
        },
    }


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    state = {"week": _week(), "live": True, "sent": [], "bg": []}

    async def fake_build(conn, owner_id, season, league_id):
        return state["week"]

    async def fake_scoreboard():
        return []

    async def fake_send(token, aps, priority=10):
        state["sent"].append((token, aps))
        return True, False

    async def fake_bg(token, data):
        state["bg"].append(token)
        return True, False

    monkeypatch.setattr(live_activity, "build_your_week", fake_build)
    monkeypatch.setattr(live_activity, "get_nfl_scoreboard", fake_scoreboard)
    monkeypatch.setattr(live_activity, "is_nfl_game_live", lambda games: state["live"])
    monkeypatch.setattr(apns_client, "send_live_activity", fake_send)
    monkeypatch.setattr(apns_client, "send_background_refresh", fake_bg)
    monkeypatch.setattr(live_activity, "_last_widget_refresh", 10**12)  # no widget pushes unless a test asks
    return state


async def _cleanup(pool, owner_id):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM live_activity_tokens WHERE owner_id = $1", owner_id)
        await conn.execute("DELETE FROM live_activity_remote_starts WHERE owner_id = $1", owner_id)


def test_props_states():
    assert live_activity.props_for(None) is None
    assert live_activity.props_for(_week(started=False))["state"] == "pre"
    assert live_activity.props_for(_week())["state"] == "live"
    assert live_activity.props_for(_week(in_play=0))["state"] == "between"
    assert live_activity.props_for(_week(in_play=0, yet=0))["state"] == "final"
    assert live_activity.props_for(_week())["winProbability"] == 72


async def test_update_once_per_change_then_end_when_final(pool, harness):
    owner = await _seed_owner(pool, 701)
    try:
        async with pool.acquire() as conn:
            await queries.upsert_activity_token(conn, owner, 1, "dev-1", "tok-a", "act-1", 7)

        await live_activity.run_tick(pool)
        assert [aps["event"] for _, aps in harness["sent"]] == ["update"]
        props = json.loads(harness["sent"][0][1]["content-state"]["props"])
        assert props["myScore"] == 50.0 and props["oppName"] == "Mile High Club"

        harness["sent"].clear()
        await live_activity.run_tick(pool)  # nothing changed
        assert harness["sent"] == []

        harness["week"] = _week(in_play=0, yet=0, my=99.0)
        async with pool.acquire() as conn:  # let the rate limit pass
            await conn.execute("UPDATE live_activity_tokens SET last_sent_at = now() - interval '1 minute' WHERE owner_id = $1", owner)
        await live_activity.run_tick(pool)
        assert [aps["event"] for _, aps in harness["sent"]] == ["end"]
        assert harness["sent"][0][1]["dismissal-date"] > harness["sent"][0][1]["timestamp"]
        async with pool.acquire() as conn:
            assert not await queries.has_active_activity(conn, owner, 7)
    finally:
        await _cleanup(pool, owner)


async def test_activity_for_an_old_matchup_is_ended(pool, harness):
    owner = await _seed_owner(pool, 702)
    try:
        async with pool.acquire() as conn:
            await queries.upsert_activity_token(conn, owner, 1, "dev-1", "tok-b", "act-2", 3)
        await live_activity.run_tick(pool)
        assert [aps["event"] for _, aps in harness["sent"]] == ["end"]
    finally:
        await _cleanup(pool, owner)


async def test_push_to_start_once_per_matchup_and_only_when_live(pool, harness):
    owner = await _seed_owner(pool, 703)
    try:
        async with pool.acquire() as conn:
            await queries.upsert_start_token(conn, owner, 1, "dev-1", "start-tok")

        harness["week"] = _week(started=False)
        await live_activity.run_tick(pool)
        assert harness["sent"] == []

        harness["week"] = _week()
        await live_activity.run_tick(pool)
        await live_activity.run_tick(pool)
        events = [aps["event"] for _, aps in harness["sent"]]
        assert events == ["start"]
        aps = harness["sent"][0][1]
        assert aps["attributes-type"] == "LiveActivityAttributes" and aps["content-state"]["name"] == "MatchupActivity"
    finally:
        await _cleanup(pool, owner)


async def test_no_start_when_no_game_is_live(pool, harness):
    owner = await _seed_owner(pool, 704)
    harness["live"] = False
    try:
        async with pool.acquire() as conn:
            await queries.upsert_start_token(conn, owner, 1, "dev-1", "start-tok-2")
        await live_activity.run_tick(pool)
        assert harness["sent"] == []
    finally:
        await _cleanup(pool, owner)


async def test_register_and_end_routes(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner = await _seed_owner(pool, 705)
    try:
        async with _client() as client:
            client.cookies.update(await _session_cookie(pool, owner))
            bad = await client.post("/push/live-activity", json={"kind": "nope", "token": "t", "device_id": "d"})
            ok = await client.post(
                "/push/live-activity",
                json={"kind": "activity", "token": "tok-r", "device_id": "dev-r", "activity_id": "act-r", "matchup_id": 9},
            )
            ended = await client.post("/push/live-activity/end", json={"activity_id": "act-r"})
        assert bad.status_code == 422
        assert ok.status_code == 200 and ended.status_code == 200
        async with pool.acquire() as conn:
            assert not await queries.has_active_activity(conn, owner, 9)
    finally:
        await _cleanup(pool, owner)


async def test_touchdown_moment_alerts_once_then_stays_as_latest_play(pool, harness, monkeypatch):
    owner = await _seed_owner(pool, 706)
    monkeypatch.setattr(live_activity, "_moments", {})
    monkeypatch.setattr(live_activity, "_alerted", {})
    try:
        async with pool.acquire() as conn:
            await queries.upsert_activity_token(conn, owner, 1, "dev-1", "tok-td", "act-td", 7, "file:///shared/ExpoWidgets/")
        await live_activity.run_tick(pool)
        harness["sent"].clear()

        live_activity.record_touchdown(owner, 1, "Puka Nacua", 8.8)
        await live_activity.run_tick(pool)  # right after the last update, but a moment skips the rate limit
        aps = harness["sent"][0][1]
        props = json.loads(aps["content-state"]["props"])
        assert aps["alert"]["title"] == "TOUCHDOWN · Puka Nacua"
        assert props["moment"] == "td" and props["lastPlay"] == "Puka Nacua TD +8.8"
        assert props["logoDir"] == "file:///shared/ExpoWidgets/" and props["myInitials"] == "GG"

        harness["sent"].clear()
        async with pool.acquire() as conn:
            await conn.execute("UPDATE live_activity_tokens SET last_sent_at = now() - interval '1 minute' WHERE owner_id = $1", owner)
        await live_activity.run_tick(pool)
        assert all("alert" not in a for _, a in harness["sent"])  # alerted once only
    finally:
        await _cleanup(pool, owner)
