"""
In-process WebSocket connection manager for Gamecast, keyed by
game_id — a sibling to app/chat/manager.py's ChatConnectionManager,
not a subclass or extension of it. Chat's manager is deliberately
owner-scoped (a message only ever goes to that conversation's real
participants); Gamecast broadcasts are the opposite shape — everyone
watching the same game gets the same update, with no per-viewer
targeting at all — so reusing chat's owner-keyed dict would mean
fighting its design rather than fitting it. Same "no Redis/pub-sub,
one in-process dict is genuinely enough at this scale" reasoning still
applies here (see that file's own docstring).
"""
from fastapi import WebSocket


class GamecastConnectionManager:
    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, game_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(game_id, set()).add(websocket)

    def disconnect(self, game_id: str, websocket: WebSocket) -> None:
        conns = self._connections.get(game_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[game_id]

    def has_subscribers(self, game_id: str) -> bool:
        return bool(self._connections.get(game_id))

    def live_game_ids(self) -> list[str]:
        return [gid for gid, conns in self._connections.items() if conns]

    async def broadcast_to_game(self, game_id: str, message: dict) -> None:
        dead = []
        for ws in list(self._connections.get(game_id, ())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(game_id, ws)


manager = GamecastConnectionManager()
