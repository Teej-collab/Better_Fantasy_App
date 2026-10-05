"""
In-process WebSocket connection registry for Watch Party rooms, keyed
by room_id (int) rather than owner — a room's fantasy-overlay digest is
genuinely a many-to-many broadcast to everyone in that room, the same
shape as Gamecast's own per-game broadcast (app/gamecast/manager.py),
not owner-scoped like chat's. A sibling of that manager, not a
subclass — same "no Redis/pub-sub, an in-process dict is genuinely
enough at this league's scale" reasoning applies here too.
"""
from fastapi import WebSocket


class WatchPartyConnectionManager:
    def __init__(self):
        self._connections: dict[int, set[WebSocket]] = {}
        # Who each socket belongs to, so the Lounge lobby can show the
        # faces of who's in a room right now, not just that someone is.
        self._owners: dict[WebSocket, int] = {}

    async def connect(self, room_id: int, websocket: WebSocket, owner_id: int | None = None) -> None:
        await websocket.accept()
        self._connections.setdefault(room_id, set()).add(websocket)
        if owner_id is not None:
            self._owners[websocket] = owner_id

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        self._owners.pop(websocket, None)
        conns = self._connections.get(room_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[room_id]

    def live_room_ids(self) -> list[int]:
        return [rid for rid, conns in self._connections.items() if conns]

    def owners_in_room(self, room_id: int) -> list[int]:
        """Distinct owners with the room open right now, in join order."""
        seen: list[int] = []
        for ws in self._connections.get(room_id, ()):
            owner_id = self._owners.get(ws)
            if owner_id is not None and owner_id not in seen:
                seen.append(owner_id)
        return seen

    async def broadcast_to_room(self, room_id: int, message: dict) -> None:
        dead = []
        for ws in list(self._connections.get(room_id, ())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room_id, ws)


manager = WatchPartyConnectionManager()
