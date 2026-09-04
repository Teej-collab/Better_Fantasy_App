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

Also tracks WHICH owner each open socket belongs to (2026-09, "who's
signed into the draft" — same owner_id-keyed shape as
app/chat/manager.py's ChatConnectionManager, including the same
"broadcast only on the real online<->offline transition" rule so a
second tab/device doesn't re-announce someone already known to be
here). This is what app/routers/draft.py's GET /draft/state and the
WS's initial draft_state frame read for each client's presence
snapshot, with live `presence` events updating it from there — an
ESPN-style "who's actually here" indicator, not the pick-timer rules
(app/domain/draft_engine.py's grace period is a flat post-autopick
rule keyed off is_autopick, not live presence, since the 5-second
window doesn't need to know who's watching — it's already the test).

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
        self._connections: dict[DraftRoomKey, dict[int, set[WebSocket]]] = {}

    async def connect(self, room: DraftRoomKey, owner_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        room_conns = self._connections.setdefault(room, {})
        was_offline = owner_id not in room_conns
        room_conns.setdefault(owner_id, set()).add(websocket)
        # exclude_owner_id=owner_id: without it, this owner's own
        # just-opened socket would receive its own "you're online"
        # event, jumping the queue ahead of the draft_state frame the
        # WS handler sends next (real bug, caught by the existing WS
        # test suite) — same exclusion app/chat/manager.py's
        # broadcast_to_all already documents for the identical reason.
        if was_offline:
            await self.broadcast_to_draft(
                room, {"type": "presence", "owner_id": owner_id, "online": True}, exclude_owner_id=owner_id
            )

    async def disconnect(self, room: DraftRoomKey, owner_id: int, websocket: WebSocket) -> None:
        room_conns = self._connections.get(room)
        if not room_conns:
            return
        conns = room_conns.get(owner_id)
        if not conns:
            return
        conns.discard(websocket)
        if conns:
            return
        del room_conns[owner_id]
        if not room_conns:
            del self._connections[room]
        # The real 1->0 transition for this owner in this room — no
        # exclude_owner_id needed here (their own socket just closed,
        # there's nothing left to jump ahead of).
        await self.broadcast_to_draft(room, {"type": "presence", "owner_id": owner_id, "online": False})

    def connected_owner_ids(self, room: DraftRoomKey) -> list[int]:
        """Every owner with at least one open draft-room socket right
        now — the initial snapshot GET /draft/state and the WS
        handshake's own draft_state frame both read this; live
        `presence` broadcasts from connect/disconnect above keep a
        connected client's copy current from there."""
        return list(self._connections.get(room, {}).keys())

    async def broadcast_to_draft(
        self, room: DraftRoomKey, message: dict, exclude_owner_id: int | None = None
    ) -> None:
        encoded = jsonable_encoder(message)
        dead: list[tuple[int, WebSocket]] = []
        for owner_id, conns in list(self._connections.get(room, {}).items()):
            if owner_id == exclude_owner_id:
                continue
            for ws in list(conns):
                try:
                    await ws.send_json(encoded)
                except Exception:
                    dead.append((owner_id, ws))
        for owner_id, ws in dead:
            await self.disconnect(room, owner_id, ws)


manager = DraftConnectionManager()
