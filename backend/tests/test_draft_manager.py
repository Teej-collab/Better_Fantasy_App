"""Pure unit tests for app/draft/manager.py's DraftConnectionManager —
fake sockets, no real network/event-loop boundary, same pattern
app/chat/manager.py's own tests use (test_chat.py's
test_connection_manager_broadcasts_presence_on_connect_and_disconnect)
for the identical reason: two real, simultaneously-open WebSocket
connections through TestClient's background thread both touching the
single asyncpg pool singleton is a real way to deadlock or corrupt
that pool for every test that runs after in the same session — this
level (calling connect/disconnect directly as plain async calls) is
what actually exercises the presence-broadcast logic safely.
"""
from app.draft.manager import DraftConnectionManager


class FakeSocket:
    def __init__(self):
        self.received = []

    async def accept(self):
        pass

    async def send_json(self, message):
        self.received.append(message)


_ROOM = (2026, 1)


async def test_connect_broadcasts_presence_to_others_not_self():
    manager = DraftConnectionManager()
    ws_a = FakeSocket()
    await manager.connect(_ROOM, 1, ws_a)
    assert ws_a.received == []  # no one else connected yet, and never told about itself

    ws_b = FakeSocket()
    await manager.connect(_ROOM, 2, ws_b)
    assert ws_a.received == [{"type": "presence", "owner_id": 2, "online": True}]
    assert ws_b.received == []  # owner 2 is never told about its own connection


async def test_a_second_socket_for_an_already_online_owner_does_not_re_announce():
    manager = DraftConnectionManager()
    ws_a = FakeSocket()
    ws_b = FakeSocket()
    await manager.connect(_ROOM, 1, ws_a)
    await manager.connect(_ROOM, 2, ws_b)

    ws_a2 = FakeSocket()
    await manager.connect(_ROOM, 1, ws_a2)
    assert ws_a2.received == []
    assert ws_b.received == []  # unchanged — owner 1 was already online, no new transition


async def test_disconnect_only_broadcasts_offline_on_the_real_last_socket():
    manager = DraftConnectionManager()
    ws_a = FakeSocket()
    ws_a2 = FakeSocket()
    ws_b = FakeSocket()
    await manager.connect(_ROOM, 1, ws_a)
    await manager.connect(_ROOM, 1, ws_a2)  # owner 1's second tab/device
    await manager.connect(_ROOM, 2, ws_b)
    ws_b.received.clear()

    await manager.disconnect(_ROOM, 1, ws_a2)
    assert ws_b.received == []  # owner 1 still online via ws_a

    await manager.disconnect(_ROOM, 1, ws_a)
    assert ws_b.received == [{"type": "presence", "owner_id": 1, "online": False}]


async def test_connected_owner_ids_reflects_who_currently_has_a_socket_open():
    manager = DraftConnectionManager()
    ws_a, ws_b = FakeSocket(), FakeSocket()
    await manager.connect(_ROOM, 1, ws_a)
    await manager.connect(_ROOM, 2, ws_b)
    assert sorted(manager.connected_owner_ids(_ROOM)) == [1, 2]

    await manager.disconnect(_ROOM, 2, ws_b)
    assert manager.connected_owner_ids(_ROOM) == [1]

    assert manager.connected_owner_ids((9999, 9999)) == []  # a room with no connections at all


async def test_rooms_are_fully_independent():
    manager = DraftConnectionManager()
    room_a, room_b = (2026, 1), (2026, 2)
    ws_a, ws_b = FakeSocket(), FakeSocket()
    await manager.connect(room_a, 1, ws_a)
    await manager.connect(room_b, 1, ws_b)  # same owner_id, a different league's draft room

    assert manager.connected_owner_ids(room_a) == [1]
    assert manager.connected_owner_ids(room_b) == [1]

    await manager.broadcast_to_draft(room_a, {"type": "pick_made"})
    assert ws_a.received == [{"type": "pick_made"}]
    assert ws_b.received == []  # room_b never saw a broadcast meant for room_a


async def test_broadcast_to_draft_excludes_the_given_owner():
    manager = DraftConnectionManager()
    ws_a, ws_b = FakeSocket(), FakeSocket()
    await manager.connect(_ROOM, 1, ws_a)
    await manager.connect(_ROOM, 2, ws_b)
    ws_a.received.clear()
    ws_b.received.clear()

    await manager.broadcast_to_draft(_ROOM, {"type": "pick_made"}, exclude_owner_id=1)
    assert ws_a.received == []
    assert ws_b.received == [{"type": "pick_made"}]


async def test_broadcast_drops_a_dead_connection():
    class DeadSocket(FakeSocket):
        async def send_json(self, message):
            raise RuntimeError("connection closed")

    manager = DraftConnectionManager()
    dead, alive = DeadSocket(), FakeSocket()
    await manager.connect(_ROOM, 1, dead)
    await manager.connect(_ROOM, 2, alive)
    alive.received.clear()

    await manager.broadcast_to_draft(_ROOM, {"type": "pick_made"})

    assert alive.received == [{"type": "pick_made"}]
    assert manager.connected_owner_ids(_ROOM) == [2]  # the dead socket's owner was dropped
