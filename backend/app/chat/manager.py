"""
In-process WebSocket connection manager for the league chat room — one
global set of active connections, broadcast to all of them on a new
message. No Redis/pub-sub: at this league's scale (~12 people) and this
app's deployment shape (one backend process), an in-process set is
genuinely enough. Revisit only if this ever needs to run as more than
one backend process (then a broadcast from process A would need to
reach a client connected to process B).
"""
from fastapi import WebSocket


class ChatConnectionManager:
    def __init__(self):
        self._connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        dead = []
        for ws in self._connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.discard(ws)


manager = ChatConnectionManager()
