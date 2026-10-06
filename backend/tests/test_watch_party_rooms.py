from datetime import datetime, timedelta, timezone

from app.domain import watch_party_rooms


class FakeConn:
    """Just enough of asyncpg for sweep_rooms: the room list, and the
    two writes it makes."""

    def __init__(self, rooms):
        self.rooms = rooms
        self.cleared, self.closed = [], []

    async def fetch(self, query, *args):
        return [r for r in self.rooms if r["closed_at"] is None]

    async def execute(self, query, *args):
        room_id = args[0]
        if "tv_game_id = NULL" in query:
            self.cleared.append(room_id)
        elif "closed_at = now()" in query:
            self.closed.append(room_id)


def _room(room_id, kind, tv=None, idle_minutes=0):
    return {
        "id": room_id, "kind": kind, "tv_game_id": tv, "closed_at": None,
        "last_active_at": datetime.now(timezone.utc) - timedelta(minutes=idle_minutes),
    }


def _scoreboard(monkeypatch, games):
    async def fake():
        return games
    monkeypatch.setattr(watch_party_rooms, "get_nfl_scoreboard", fake)
    watch_party_rooms._final_seen.clear()


async def test_a_long_finished_game_clears_off_the_tv(monkeypatch):
    kickoff = (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat()
    _scoreboard(monkeypatch, [{"id": "1", "state": "post", "date": kickoff}])
    conn = FakeConn([_room(10, "open", tv="1")])
    result = await watch_party_rooms.sweep_rooms(conn, set())
    assert result["cleared"] == [10]
    assert conn.closed == []  # the League Lounge never closes


async def test_a_game_that_just_ended_gets_a_grace_period(monkeypatch):
    kickoff = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    _scoreboard(monkeypatch, [{"id": "1", "state": "post", "date": kickoff}])
    conn = FakeConn([_room(10, "open", tv="1")])
    assert (await watch_party_rooms.sweep_rooms(conn, set()))["cleared"] == []


async def test_last_weeks_game_clears_right_away(monkeypatch):
    _scoreboard(monkeypatch, [{"id": "2", "state": "pre", "date": datetime.now(timezone.utc).isoformat()}])
    conn = FakeConn([_room(10, "open", tv="1")])
    assert (await watch_party_rooms.sweep_rooms(conn, set()))["cleared"] == [10]


async def test_an_empty_party_closes_once_its_game_is_over(monkeypatch):
    kickoff = (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat()
    _scoreboard(monkeypatch, [{"id": "1", "state": "post", "date": kickoff}])
    conn = FakeConn([_room(20, "party", tv="1", idle_minutes=30), _room(21, "party", tv="1", idle_minutes=30)])
    result = await watch_party_rooms.sweep_rooms(conn, live_room_ids={21})
    assert result["closed"] == [20]  # 21 still has people in it


async def test_a_party_with_a_live_game_stays_open_until_idle(monkeypatch):
    _scoreboard(monkeypatch, [{"id": "1", "state": "in", "date": datetime.now(timezone.utc).isoformat()}])
    conn = FakeConn([_room(20, "party", tv="1", idle_minutes=30), _room(21, "party", tv="1", idle_minutes=180)])
    assert (await watch_party_rooms.sweep_rooms(conn, set()))["closed"] == [21]
