"""
In-process WebSocket connection manager, keyed by owner_id (an owner
can have more than one open tab/device, hence a set per owner) rather
than one flat set of connections — chat v1 broadcast to literally
everyone connected, which was fine for a single shared room but can't
work now that direct conversations need to stay private. A conversation
event is sent only to that conversation's participants (looked up from
conversation_participants, see app/routers/chat.py), not to every
connected client.

Still no Redis/pub-sub: at this league's scale (~12 people) and this
app's one-process deployment shape, an in-process dict is genuinely
enough — same call as chat v1, revisit only if this ever runs as more
than one backend process.
"""
from fastapi import WebSocket


class ChatConnectionManager:
    def __init__(self):
        self._connections: dict[int, set[WebSocket]] = {}

    async def connect(self, owner_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(owner_id, set()).add(websocket)

    def disconnect(self, owner_id: int, websocket: WebSocket) -> None:
        conns = self._connections.get(owner_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[owner_id]

    def is_connected(self, owner_id: int) -> bool:
        """True if this owner has at least one open chat WebSocket right
        now — used to skip push notifications for people already
        watching chat live (app/routers/chat.py's message handler),
        rather than double-notifying someone with the app open."""
        return bool(self._connections.get(owner_id))

    async def send_to_owner(self, owner_id: int, message: dict) -> None:
        dead = []
        for ws in list(self._connections.get(owner_id, ())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(owner_id, ws)

    async def broadcast_to_owners(self, owner_ids, message: dict) -> None:
        for owner_id in owner_ids:
            await self.send_to_owner(owner_id, message)


manager = ChatConnectionManager()
