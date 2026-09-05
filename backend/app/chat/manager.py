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
        # Per-socket document.visibilityState, reported by the client
        # itself (frontend/src/components/PresenceProvider.tsx and
        # ChatApp.tsx both send a `visibility` frame on connect and on
        # every visibilitychange) — see has_visible_connection's own
        # docstring for the real bug this exists to fix.
        self._visible: dict[WebSocket, bool] = {}

    async def connect(self, owner_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        was_offline = owner_id not in self._connections
        self._connections.setdefault(owner_id, set()).add(websocket)
        # Assumed foreground until the client's own first visibility
        # frame says otherwise (sent immediately after connect) — a
        # brief window where a background reconnect could look
        # "visible" is harmless: worst case, one push arrives that a
        # strictly correct client wouldn't have needed.
        self._visible[websocket] = True
        # Only fires on the real 0->1 transition — an owner opening a
        # second tab/device while already connected elsewhere doesn't
        # re-announce "online" (they already are, per every other
        # client's own state).
        if was_offline:
            await self.broadcast_to_all(
                {"type": "presence", "owner_id": owner_id, "online": True}, exclude_owner_id=owner_id
            )

    async def disconnect(self, owner_id: int, websocket: WebSocket) -> None:
        self._visible.pop(websocket, None)
        conns = self._connections.get(owner_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self._connections[owner_id]
            # The real 1->0 transition — this owner's last open
            # socket (across every tab/device) just closed.
            await self.broadcast_to_all(
                {"type": "presence", "owner_id": owner_id, "online": False}, exclude_owner_id=owner_id
            )

    def connected_owner_ids(self) -> list[int]:
        """Every owner with at least one open socket right now —
        app-wide, not chat-specific (PresenceProvider.tsx mounts this
        same connection at the root layout, open regardless of which
        page is up), which is what makes this the real "who has the
        app open right now" signal the admin-only GET /admin/online
        reads, not just "who has Chat open"."""
        return list(self._connections.keys())

    def set_visibility(self, websocket: WebSocket, visible: bool) -> None:
        if websocket in self._visible:
            self._visible[websocket] = visible

    def has_visible_connection(self, owner_id: int) -> bool:
        """True if this owner has at least one open socket CURRENTLY in
        the foreground (document.visibilityState === "visible" on the
        client) — the real "are they actively watching chat right now"
        signal for push-notification suppression (app/routers/chat.py's
        _push_notify_new_message), distinct from is_connected/
        connected_owner_ids' "has the app open at all."

        This is a real bug fix (2026-09): before this existed, push
        suppression used plain is_connected, which PresenceProvider.tsx's
        own app-wide socket keeps true for as long as the app is open
        ANYWHERE — including fully backgrounded on a phone with the
        screen off — not just while actually looking at chat. That
        silently swallowed every chat push notification for anyone who
        keeps the app open in the background, regardless of their own
        notify_league_chat/notify_direct_messages/etc. preference —
        exactly the reported symptom: all notifications on, the test
        notification works, but real chat messages never push."""
        conns = self._connections.get(owner_id, ())
        return any(self._visible.get(ws, False) for ws in conns)

    def is_connected(self, owner_id: int) -> bool:
        """True if this owner has at least one open chat WebSocket right
        now — used to skip push notifications for people already
        watching chat live (app/routers/chat.py's message handler),
        rather than double-notifying someone with the app open. Also
        the source of truth GET /chat/members reads for each member's
        initial `online` snapshot (app/routers/chat.py's list_members),
        which live `presence` broadcasts then update in place."""
        return bool(self._connections.get(owner_id))

    async def send_to_owner(self, owner_id: int, message: dict) -> None:
        dead = []
        for ws in list(self._connections.get(owner_id, ())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(owner_id, ws)

    async def broadcast_to_owners(self, owner_ids, message: dict) -> None:
        for owner_id in owner_ids:
            await self.send_to_owner(owner_id, message)

    async def broadcast_to_all(self, message: dict, exclude_owner_id: int | None = None) -> None:
        """Every currently-connected owner, not just one conversation's
        participants — presence is the one real use for this (everyone
        in the league should see everyone else's dot update live), as
        opposed to every other broadcast in this class, which stays
        scoped to a conversation on purpose. exclude_owner_id skips
        telling someone about their own connection transition — they
        already know they just connected/disconnected, and (real bug,
        caught by the existing WebSocket test suite) a client's very
        first frame after connecting would otherwise be its own
        "you're online" event, jumping the queue ahead of whatever
        that client was actually about to do next."""
        for owner_id in list(self._connections.keys()):
            if owner_id == exclude_owner_id:
                continue
            await self.send_to_owner(owner_id, message)


manager = ChatConnectionManager()
