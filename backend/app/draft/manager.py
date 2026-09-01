"""
In-process WebSocket connection manager for the draft room, keyed by
(season, league_id) — same shape and reasoning as
app/gamecast/manager.py's GamecastConnectionManager (one in-process
dict is genuinely enough at this scale; see that file's docstring).

Widened from a bare season key (see TODO.md's PHASE 9 entry) — two
leagues drafting in the same real season used to share one WebSocket
room, so a pick made in League #2's draft would broadcast live to
League #1's connected clients too. league_id here always comes from
the server-resolved session (app/auth/league_context.py), never a
client-supplied value — draft.py's WS handler still takes `season` as
a query param (which draft to open), but the room identity itself is
never just "whatever the client claims."

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

DraftRoomKey = tuple[int, int]  # (season, league_id)


class DraftConnectionManager:
    def __init__(self):
        self._connections: dict[DraftRoomKey, set[WebSocket]] = {}

    async def connect(self, room: DraftRoomKey, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(room, set()).add(websocket)

    def disconnect(self, room: DraftRoomKey, websocket: WebSocket) -> None:
        conns = self._connections.get(room)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[room]

    async def broadcast_to_draft(self, room: DraftRoomKey, message: dict) -> None:
        encoded = jsonable_encoder(message)
        dead = []
        for ws in list(self._connections.get(room, ())):
            try:
                await ws.send_json(encoded)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room, ws)


manager = DraftConnectionManager()
