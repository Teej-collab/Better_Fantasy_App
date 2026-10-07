"""Waiver results, matchup finals, pre-kickoff and close-game pushes
(app/notifications/game_alerts.py)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.notifications import formatter, game_alerts

NOW = datetime(2026, 10, 11, 15, 0, tzinfo=timezone.utc)


def _player(name, slot="WR", status="scheduled", kickoff=NOW + timedelta(hours=1), injury=None, scored=None, proj=12.0, pid=None):
    return {
        "player_name": name, "lineup_slot": slot, "game_status": status, "game_time": kickoff.isoformat(),
        "injury_status": injury, "points_scored": scored, "points_projected": proj, "live_projected": proj,
        "player_id": pid or name.lower().replace(" ", "-"),
    }


def _side(team_id, owner_id, name, score, roster, record="4-1"):
    return {"team_id": team_id, "owner_id": owner_id, "team_name": name, "score": score, "record": record, "roster": roster}


@pytest.fixture
def sent(monkeypatch):
    out = []

    async def fake_send(conn, owner_id, payload, category):
        out.append((owner_id, payload, category))

    monkeypatch.setattr(game_alerts, "_send", fake_send)
    return out


def _context(monkeypatch, matchups):
    async def fake(conn, season, week, league_id):
        return {"matchups": matchups}

    monkeypatch.setattr(game_alerts, "build_week_matchup_context", fake)


async def _clear(pool):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM notification_once WHERE key LIKE '%-9999-%'")


async def test_matchup_finals_once_with_win_and_loss(pool, monkeypatch, sent):
    await _clear(pool)
    _context(monkeypatch, [{"matchup_id": 7, "home": _side(1, 11, "Gridiron Gang", 121.4, []), "away": _side(2, 22, "Mile High Club", 98.0, [], "3-2")}])
    async with pool.acquire() as conn:
        await game_alerts.notify_matchup_finals(conn, 9999, 6, 1)
        await game_alerts.notify_matchup_finals(conn, 9999, 6, 1)
    titles = {owner: p["title"] for owner, p, _ in sent}
    assert len(sent) == 2
    assert titles[11] == "🏆 You beat Mile High Club" and "now 4-1" in sent[0][1]["body"]
    assert titles[22] == "Gridiron Gang beat you"
    await _clear(pool)


async def test_pregame_alert_for_an_out_starter_only(pool, monkeypatch, sent):
    await _clear(pool)
    roster = [
        _player("Puka Nacua", injury="Out", kickoff=NOW + timedelta(minutes=80)),
        _player("Bench Guy", slot="BE", injury="Out", kickoff=NOW + timedelta(minutes=80)),
        _player("Far Away", injury="Out", kickoff=NOW + timedelta(hours=5)),
        _player("Healthy", kickoff=NOW + timedelta(minutes=80)),
    ]
    _context(monkeypatch, [{"matchup_id": 8, "home": _side(1, 11, "Gang", 0, roster), "away": _side(2, 22, "Club", 0, [])}])
    async with pool.acquire() as conn:
        await game_alerts.check_pregame_lineups(conn, 9999, 6, 1, NOW)
        await game_alerts.check_pregame_lineups(conn, 9999, 6, 1, NOW)
    assert len(sent) == 1
    assert sent[0][1]["title"] == "🚨 Puka Nacua is OUT — he's in your lineup" and sent[0][2] == "notify_injuries"
    await _clear(pool)


async def test_close_game_when_it_comes_down_to_one_window(pool, monkeypatch, sent):
    await _clear(pool)
    mnf = NOW + timedelta(minutes=30)
    home = _side(1, 11, "Gang", 100.0, [_player("Done Guy", status="final", scored=20.0)])
    away = _side(2, 22, "Club", 91.6, [_player("Travis Kelce", slot="TE", kickoff=mnf, proj=12.1)])
    _context(monkeypatch, [{"matchup_id": 9, "home": home, "away": away}])
    async with pool.acquire() as conn:
        await game_alerts.check_close_games(conn, 9999, 6, 1, NOW)
        await game_alerts.check_close_games(conn, 9999, 6, 1, NOW)
    by_owner = {o: p for o, p, _ in sent}
    assert len(sent) == 2
    assert by_owner[22]["title"] == "🔥 Close one: you're down 8.4" and "Travis Kelce" in by_owner[22]["body"]
    assert by_owner[11]["title"] == "😬 Hang on: you're up 8.4"
    await _clear(pool)


async def test_no_close_game_when_out_of_reach_or_more_games_left(pool, monkeypatch, sent):
    await _clear(pool)
    blowout = {"matchup_id": 10, "home": _side(1, 11, "Gang", 150.0, []), "away": _side(2, 22, "Club", 80.0, [_player("Kelce", kickoff=NOW + timedelta(minutes=30))])}
    two_windows = {"matchup_id": 11, "home": _side(3, 33, "A", 90.0, [_player("Sun", kickoff=NOW + timedelta(minutes=30))]),
                   "away": _side(4, 44, "B", 88.0, [_player("Mon", kickoff=NOW + timedelta(days=1))])}
    _context(monkeypatch, [blowout, two_windows])
    async with pool.acquire() as conn:
        await game_alerts.check_close_games(conn, 9999, 6, 1, NOW)
    assert sent == []
    await _clear(pool)


def test_waiver_result_wording():
    won = formatter.waiver_results([{"player": "Tank Dell", "dropped": "Jake Ferguson", "bid": 12}], [])
    assert won["title"] == "✅ You got Tank Dell" and won["body"] == "$12 · dropped Jake Ferguson"
    lost = formatter.waiver_results([], [{"player": "Tank Dell", "reason": "Outbid — a higher bid won this player"}])
    assert lost["title"] == "❌ Waiver claim on Tank Dell failed"
    mixed = formatter.waiver_results([{"player": "A", "dropped": None, "bid": None}], [{"player": "B", "reason": "x"}])
    assert mixed["title"] == "🧾 Waivers: 1 won, 1 failed" and "Got A; Missed B" in mixed["body"]


def test_quiet_hours_hold_waivers_and_finals():
    from app.notifications import quiet_hours

    assert {"waiver_results", "matchup_final"} <= quiet_hours._HOLD_UNTIL_MORNING
