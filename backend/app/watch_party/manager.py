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

    async def connect(self, room_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(room_id, set()).add(websocket)

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        conns = self._connections.get(room_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[room_id]

    def live_room_ids(self) -> list[int]:
        return [rid for rid, conns in self._connections.items() if conns]

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
