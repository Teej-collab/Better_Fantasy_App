"""
In-process WebSocket connection manager for the draft room, keyed by
season — same shape and reasoning as app/gamecast/manager.py's
GamecastConnectionManager (one in-process dict is genuinely enough at
this scale; see that file's docstring), just keyed by an int season
instead of a str game_id since a draft is season-scoped, not per-game.

Gamecast only ever broadcasts Pydantic models via .model_dump(mode=
"json"), which handles datetime/Decimal encoding itself. Draft state is
plain dicts straight off asyncpg rows (draft_config/draft_picks carry
real datetime columns — current_pick_deadline, made_at, etc.), and
Starlette's websocket.send_json() uses plain json.dumps with no
datetime support — so broadcast_to_draft runs every message through
FastAPI's jsonable_encoder first, once, centrally, rather than trusting
every call site to remember to pre-encode.
"""
from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder


class DraftConnectionManager:
    def __init__(self):
        self._connections: dict[int, set[WebSocket]] = {}

    async def connect(self, season: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(season, set()).add(websocket)

    def disconnect(self, season: int, websocket: WebSocket) -> None:
        conns = self._connections.get(season)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[season]

    async def broadcast_to_draft(self, season: int, message: dict) -> None:
        encoded = jsonable_encoder(message)
        dead = []
        for ws in list(self._connections.get(season, ())):
            try:
                await ws.send_json(encoded)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(season, ws)


manager = DraftConnectionManager()
