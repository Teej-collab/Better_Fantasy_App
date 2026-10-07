"""Game-day inactives (app/notifications/inactives.py)."""
from datetime import datetime, timedelta, timezone

from app.notifications import inactives

NOW = datetime(2026, 10, 11, 15, 30, tzinfo=timezone.utc)


def _game(gid, minutes_to_kickoff, state="pre"):
    return {"id": gid, "state": state, "date": (NOW + timedelta(minutes=minutes_to_kickoff)).isoformat(), "home_team": "BUF", "away_team": "NE"}


def test_window_is_100_minutes_before_to_10_after_kickoff():
    inactives._reset_for_tests()
    games = [_game("a", 90), _game("b", 150), _game("c", -5, "in"), _game("d", -30, "in"), _game("e", 30, "post")]
    assert [g["id"] for g in inactives.games_in_window(games, NOW)] == ["a", "c"]


class FakeConn:
    def __init__(self, rows, existing_keys=()):
        self.rows = rows
        self.keys = set(existing_keys)

    async def fetch(self, sql, *args):
        return self.rows

    async def fetchval(self, sql, *args):
        return 1 if args and args[0] in self.keys else None

    async def fetchrow(self, sql, *args):
        if args[0] in self.keys:
            return None
        self.keys.add(args[0])
        return {"key": args[0]}


async def test_only_starters_once_and_not_after_a_listed_out_alert(monkeypatch):
    sent = []

    async def fake_send(conn, owner_id, payload):
        sent.append((owner_id, payload))

    async def prefs(conn, owner_id):
        return {"push_enabled": True, "notify_injuries": True}

    monkeypatch.setattr(inactives.dispatcher, "send_to_owner", fake_send)
    monkeypatch.setattr(inactives.preferences_queries, "get_preferences", prefs)
    rows = [
        {"team_id": 1, "lineup_slot": "WR", "owner_id": 11, "league_id": 1, "full_name": "Puka Nacua", "sleeper_player_id": "p1"},
        {"team_id": 2, "lineup_slot": "BE", "owner_id": 22, "league_id": 1, "full_name": "Puka Nacua", "sleeper_player_id": "p1"},
        {"team_id": 3, "lineup_slot": "RB", "owner_id": 33, "league_id": 1, "full_name": "Already Out", "sleeper_player_id": "p2"},
    ]
    conn = FakeConn(rows, existing_keys={"pregame-1-2026-6-3-p2"})
    await inactives.notify_inactive_starters(conn, 2026, 6, [101, 102], "1:00 PM ET")
    await inactives.notify_inactive_starters(conn, 2026, 6, [101, 102], "1:00 PM ET")
    assert [(o, p["title"]) for o, p in sent] == [(11, "🚫 Puka Nacua is INACTIVE")]
