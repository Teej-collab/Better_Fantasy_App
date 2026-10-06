"""
Watch Party rooms — group video/voice reached from Chat (2026-09-16
plan). Phase 1: room list/create and LiveKit token minting. Phase 2: a
WebSocket per room broadcasting the live "fantasy digest" (close/live
league matchups) — see app/domain/watch_party.py and
app/watch_party/manager.py, and the scheduler job in app/scheduler.py
that actually pushes updates on a poll cadence. Phase 3: each room's
text chat reuses the existing chat stack rather than a second one —
see app/queries/watch_party.py's own docstring on how a room links to
a real conversations row.

Auth pattern copied from app/routers/chat.py (_require_session is a
local per-router helper there too, not shared). League/membership
scoping uses the same require_active_league_id/resolve_owner_id this
whole app's league-scoped routers already depend on.
"""
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, resolve_owner_id
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, decode_ticket_token, get_session_token
from app.config import _require, require_livekit_configured
from app.db import get_pool
from app.domain import watch_party as watch_party_domain
from app.domain import watch_party_rooms
from app.providers.nfl_scoreboard import get_nfl_scoreboard
from app.queries import chat as chat_queries
from app.queries import league as league_queries
from app.queries import watch_party as watch_party_queries
from app.watch_party.manager import manager as watch_party_manager

router = APIRouter(prefix="/watch-party", tags=["watch_party"])

# A real watch-party session can run for an entire game slate — much
# longer than the existing WS ticket's 60s or even the chug upload
# ticket's 15 minutes (see auth.py's TICKET_PURPOSES). Rather than mint
# one token that has to outlive an entire Sunday, the frontend is
# expected to re-request a token well before this expires; 6 hours
# comfortably covers one sitting without leaving a token usable long
# after someone's actually done watching.
TOKEN_TTL_SECONDS = 6 * 60 * 60


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(get_session_token(request))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def _room_dict(row, member_count: int, is_live: bool, watchers: list[dict] | None = None) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "created_by_owner_id": row["created_by_owner_id"],
        # An open party's host, for the lobby ("TJ's party").
        "host_name": row["host_name"] if "host_name" in row.keys() else None,
        "member_count": member_count,
        "conversation_id": row["conversation_id"],
        # Real occupancy (is anyone's FantasyTicker socket currently
        # open for this room — see watch_party_manager), not the same
        # thing as member_count, which is "how many COULD join," a
        # static number. Phase 4's "someone's in League Lounge" signal.
        "is_live": is_live,
        # What's on the room's TV and how far behind the live data it
        # runs (migration b3e9f2a6c8d1) — the room holds everything about
        # that game back by tv_delay_seconds so nothing spoils the stream.
        "tv_game_id": row["tv_game_id"],
        "tv_delay_seconds": row["tv_delay_seconds"],
        # Who has the room open right now, for the lobby's faces.
        "watchers": watchers or [],
    }


async def _watchers_by_room(conn, room_ids: list[int]) -> dict[int, list[dict]]:
    owners_by_room = {rid: watch_party_manager.owners_in_room(rid) for rid in room_ids}
    all_ids = sorted({o for ids in owners_by_room.values() for o in ids})
    if not all_ids:
        return {rid: [] for rid in room_ids}
    rows = await conn.fetch(
        "SELECT owner_id, display_name FROM owners WHERE owner_id = ANY($1::int[])", all_ids
    )
    names = {r["owner_id"]: r["display_name"] for r in rows}
    return {
        rid: [{"owner_id": o, "display_name": names.get(o) or "Owner"} for o in ids]
        for rid, ids in owners_by_room.items()
    }


@router.get("/rooms")
async def list_rooms(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        active_season = int(_require("ACTIVE_SEASON"))

        open_room = await watch_party_queries.get_or_create_open_room(conn, league_id, owner_id)
        # Clear finished games off TVs and close empty parties first, so
        # the lobby never shows a game that's over or a dead room.
        swept = await watch_party_rooms.sweep_rooms(conn, set(watch_party_manager.live_room_ids()), league_id)
        if swept["cleared"]:
            open_room = await watch_party_queries.get_open_room(conn, league_id)
        party_rooms = await watch_party_queries.list_party_rooms(conn, league_id)
        # list_eligible_members excludes the requester themselves (see
        # its own docstring) — +1 accounts for that so the open room's
        # count reads as "everyone", not "everyone but you".
        eligible = await chat_queries.list_eligible_members(conn, active_season, league_id, owner_id)
        private_rooms = await watch_party_queries.list_private_rooms_for_owner(conn, league_id, owner_id)
        watchers = await _watchers_by_room(
            conn, [open_room["id"], *[r["id"] for r in party_rooms], *[r["id"] for r in private_rooms]]
        )

    live_room_ids = set(watch_party_manager.live_room_ids())
    await _announce_sweep(swept)

    return {
        "open_room": _room_dict(
            open_room, len(eligible) + 1, open_room["id"] in live_room_ids, watchers.get(open_room["id"])
        ),
        # Open watch parties anyone in the league can join (2026-10).
        "party_rooms": [
            _room_dict(r, len(eligible) + 1, r["id"] in live_room_ids, watchers.get(r["id"])) for r in party_rooms
        ],
        "private_rooms": [
            _room_dict(r, r["member_count"], r["id"] in live_room_ids, watchers.get(r["id"])) for r in private_rooms
        ],
    }


async def _announce_sweep(swept: dict) -> None:
    """Tells anyone sitting in a room that its TV cleared or the party
    closed (app/domain/watch_party_rooms.py)."""
    for room_id in swept["cleared"]:
        await watch_party_manager.broadcast_to_room(room_id, {"type": "tv", "room_id": room_id, "tv_game_id": None})
    for room_id in swept["closed"]:
        await watch_party_manager.broadcast_to_room(room_id, {"type": "closed", "room_id": room_id})


@router.put("/rooms/{room_id}/tv")
async def set_room_tv(room_id: int, request: Request, pool=Depends(get_pool)):
    """Sets what's on the room's TV and/or its delay. The apps only show
    these controls to whoever is sharing their screen (the room picks
    "whoever's sharing" as the one who knows what's on it), but any
    member may call this — sharing happens in the video call, which this
    server doesn't see. Everyone in the room gets the change at once
    over the room's socket."""
    payload = _require_session(request)
    body = await request.json()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        room = await _room_if_accessible(conn, room_id, league_id, owner_id)
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found")

        game_id = room["tv_game_id"]
        if "game_id" in body:
            raw = body.get("game_id")
            game_id = str(raw).strip() if raw else None
            if game_id is not None and not game_id.isdigit():
                raise HTTPException(status_code=400, detail="game_id must be an ESPN event id")
        delay = room["tv_delay_seconds"]
        if "delay_seconds" in body:
            try:
                delay = int(body.get("delay_seconds"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="delay_seconds must be a number")
            delay = max(0, min(180, delay))

        await conn.execute(
            "UPDATE watch_party_rooms SET tv_game_id = $1, tv_delay_seconds = $2, tv_set_by_owner_id = $3, "
            "tv_updated_at = now() WHERE id = $4",
            game_id, delay, owner_id, room_id,
        )

    message = {"type": "tv", "room_id": room_id, "tv_game_id": game_id, "tv_delay_seconds": delay, "set_by_owner_id": owner_id}
    await watch_party_manager.broadcast_to_room(room_id, message)
    return message


@router.get("/lobby")
async def lobby(request: Request, pool=Depends(get_pool)):
    """The Lounge lobby: this week's games ranked by what's riding on
    them for you — your starters, your opponent's starters, and your open
    bets — so "games that matter to you" leads. Rooms come from /rooms."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    games = await get_nfl_scoreboard()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        week = await league_queries.get_cached_current_week(conn, season)
        my_team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, owner_id, league_id,
        )
        opp_team_id = None
        if my_team_id is not None and week is not None:
            opp_team_id = await conn.fetchval(
                "SELECT CASE WHEN home_team_id = $1 THEN away_team_id ELSE home_team_id END FROM matchups "
                "WHERE season = $2 AND week = $3 AND league_id = $4 AND $1 IN (home_team_id, away_team_id)",
                my_team_id, season, week, league_id,
            )
        mine = await league_queries.get_current_roster(conn, season, my_team_id, week) if my_team_id and week else []
        theirs = await league_queries.get_current_roster(conn, season, opp_team_id, week) if opp_team_id and week else []
        opp_name = await conn.fetchval("SELECT team_name FROM teams_by_season WHERE id = $1", opp_team_id) if opp_team_id else None
        bet_rows = await conn.fetch(
            """
            SELECT bl.espn_event_id, bl.team_abbr FROM bet_legs bl JOIN bets b ON b.id = bl.bet_id
            WHERE b.user_id = $1 AND b.status = 'open' AND bl.status = 'open'
            """,
            payload["user_id"],
        )

    def starters_on(roster, teams):
        return [r for r in roster if r["lineup_slot"] not in ("BE", "IR") and r["pro_team"] in teams]

    out = []
    for g in games:
        teams = {g.get("home_team"), g.get("away_team")}
        my_players = starters_on(mine, teams)
        their_players = starters_on(theirs, teams)
        bets = sum(1 for b in bet_rows if b["espn_event_id"] == g.get("id") or b["team_abbr"] in teams)
        out.append({
            "game_id": g.get("id"),
            "home_team": g.get("home_team"),
            "away_team": g.get("away_team"),
            "home_score": g.get("home_score"),
            "away_score": g.get("away_score"),
            "state": g.get("state"),
            "status_detail": g.get("status_detail"),
            "date": g.get("date"),
            "is_redzone": g.get("is_redzone"),
            "possession_team_abbr": g.get("possession_team_abbr"),
            "my_players": [r["player_name"] for r in my_players],
            "opponent_players": [r["player_name"] for r in their_players],
            "opponent_team_name": opp_name,
            "open_bet_legs": bets,
            "stakes": len(my_players) * 3 + len(their_players) * 2 + bets * 2,
        })
    order = {"in": 0, "pre": 1, "post": 2}
    out.sort(key=lambda g: (order.get(g["state"], 3), -g["stakes"], g["date"] or ""))
    return {"week": week, "games": out}


@router.post("/rooms")
async def create_room(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    invited_owner_ids = body.get("invited_owner_ids") or []

    # "Start a watch party" (2026-10): an open room the whole league can
    # walk into, with its own TV — no invites. Optionally starts with a
    # game on the TV.
    if body.get("kind") == "party":
        game_id = str(body.get("game_id") or "").strip() or None
        if game_id is not None and not game_id.isdigit():
            raise HTTPException(status_code=400, detail="game_id must be an ESPN event id")
        async with pool.acquire() as conn:
            league_id = await require_active_league_id(conn, payload)
            owner_id = await resolve_owner_id(conn, payload)
            if not name:
                host = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)
                name = f"{(host or 'Someone').split()[0]}'s watch party"
            room_id = await watch_party_queries.create_party_room(conn, league_id, name[:60], owner_id)
            if game_id:
                await conn.execute(
                    "UPDATE watch_party_rooms SET tv_game_id = $1, tv_set_by_owner_id = $2, tv_updated_at = now() WHERE id = $3",
                    game_id, owner_id, room_id,
                )
        return {"id": room_id}

    if not name:
        raise HTTPException(status_code=400, detail="Party name is required")
    if not isinstance(invited_owner_ids, list) or not all(isinstance(i, int) for i in invited_owner_ids):
        raise HTTPException(status_code=400, detail="invited_owner_ids must be a list of owner ids")

    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        active_season = int(_require("ACTIVE_SEASON"))

        # Only real league members can be invited — the same pool
        # chat's own "new message" search draws from, not an arbitrary
        # owner id someone could otherwise pass in the request body.
        eligible_ids = {
            m["owner_id"] for m in await chat_queries.list_eligible_members(conn, active_season, league_id, owner_id)
        }
        invalid = [i for i in invited_owner_ids if i not in eligible_ids]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Not a member of your league: {invalid}")

        room_id = await watch_party_queries.create_private_room(conn, league_id, name, owner_id, invited_owner_ids)

    return {"id": room_id}


@router.delete("/rooms/{room_id}")
async def end_party(room_id: int, request: Request, pool=Depends(get_pool)):
    """Ends an open watch party — its host or the commissioner. (Empty
    parties also close on their own; the League Lounge never does.)"""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        room = await watch_party_queries.get_room(conn, room_id)
        if room is None or room["league_id"] != league_id or room["kind"] != "party" or room["closed_at"] is not None:
            raise HTTPException(status_code=404, detail="Party not found")
        is_commissioner = await chat_queries.is_owner_commissioner_of_league(conn, owner_id, league_id)
        if room["created_by_owner_id"] != owner_id and not is_commissioner:
            raise HTTPException(status_code=403, detail="Only the host or your commissioner can end this party")
        await watch_party_queries.close_room(conn, room_id)
    await watch_party_manager.broadcast_to_room(room_id, {"type": "closed", "room_id": room_id})
    return {"status": "closed"}


@router.get("/rooms/{room_id}/members")
async def list_room_members(room_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)

        room = await watch_party_queries.get_room(conn, room_id)
        if room is None or room["league_id"] != league_id or room["kind"] != "private":
            raise HTTPException(status_code=404, detail="Room not found")
        if not await watch_party_queries.is_private_room_member(conn, room_id, owner_id):
            raise HTTPException(status_code=404, detail="Room not found")

        members = await watch_party_queries.list_room_members(conn, room_id)

    return {
        "members": [{"owner_id": m["owner_id"], "display_name": m["display_name"]} for m in members],
        "created_by_owner_id": room["created_by_owner_id"],
    }


@router.delete("/rooms/{room_id}/members/{target_owner_id}")
async def remove_room_member(room_id: int, target_owner_id: int, request: Request, pool=Depends(get_pool)):
    """Room creator or the league commissioner only — "commissioner-
    level controls," per the approved plan, deliberately means both:
    the person who actually started this private party is its natural
    day-to-day manager, with the commissioner able to step in too
    (same override relationship Commish's Corner posting already has).
    Revokes future room/chat access; does not forcibly disconnect an
    already-live LiveKit session — see remove_private_room_member's
    own docstring on why that's a separate, not-yet-built piece."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)

        room = await watch_party_queries.get_room(conn, room_id)
        if room is None or room["league_id"] != league_id or room["kind"] != "private":
            raise HTTPException(status_code=404, detail="Room not found")

        is_creator = room["created_by_owner_id"] == owner_id
        is_commissioner = await chat_queries.is_owner_commissioner_of_league(conn, owner_id, league_id)
        if not (is_creator or is_commissioner):
            raise HTTPException(status_code=403, detail="Only this party's host or your commissioner can remove someone")
        if target_owner_id == room["created_by_owner_id"]:
            raise HTTPException(status_code=400, detail="Can't remove the party's host")

        await watch_party_queries.remove_private_room_member(conn, room_id, room["conversation_id"], target_owner_id)

    return {"status": "removed"}


async def _room_if_accessible(conn, room_id: int, league_id: int, owner_id: int):
    """None if the room doesn't exist, belongs to another league, is
    closed, or (for a 'private' room) this owner was never invited.
    'open' room membership is implicit — require_active_league_id and
    resolve_owner_id having already succeeded for this league IS the
    whole definition of eligibility for it; only 'private' rooms need
    an actual membership-row check. Shared by the token endpoint and
    the /ws route below so the two never drift out of sync on who's
    actually allowed into a room."""
    room = await watch_party_queries.get_room(conn, room_id)
    if room is None or room["league_id"] != league_id or room["closed_at"] is not None:
        return None
    if room["kind"] == "private" and not await watch_party_queries.is_private_room_member(conn, room_id, owner_id):
        return None
    return room


@router.post("/rooms/{room_id}/token")
async def get_room_token(room_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    api_key, api_secret, livekit_url = require_livekit_configured()

    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)

        room = await _room_if_accessible(conn, room_id, league_id, owner_id)
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found")

        # First real "joining" moment for the open room (a private
        # room's invitees are already participants from creation) — see
        # ensure_conversation_participant's own docstring.
        await watch_party_queries.ensure_conversation_participant(conn, room["conversation_id"], owner_id)
        await watch_party_queries.touch_room(conn, room_id)

        display_name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)

    now = int(time.time())
    # Scoped by league AND room id, not just room id, so a room id
    # collision across two different leagues (ids are global, not
    # per-league) can never land two unrelated leagues in the same
    # LiveKit room by accident.
    livekit_room_name = f"league-{league_id}-room-{room_id}"
    claims = {
        "iss": api_key,
        "sub": str(owner_id),
        "name": display_name or "Owner",
        "nbf": now,
        "exp": now + TOKEN_TTL_SECONDS,
        # Video grant shape confirmed against LiveKit's own
        # python-sdks source (livekit-api/livekit/api/access_token.py)
        # rather than assumed — see app/config.py's comment.
        "video": {
            "room": livekit_room_name,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    token = jwt.encode(claims, api_secret, algorithm="HS256")

    return {"token": token, "url": livekit_url, "room_name": livekit_room_name}


@router.websocket("/ws")
async def watch_party_ws(websocket: WebSocket, room_id: int, ticket: str | None = None):
    """Push-only, same shape as Gamecast's own /nfl/gamecast/ws — sends
    one fantasy_digest snapshot immediately on connect (if one's
    computable right now), then the scheduler job's poll results get
    broadcast to every connected socket for this room_id (see
    _run_watch_party_poll_job in app/scheduler.py). This socket never
    reads anything meaningful from the client; any inbound payload is
    ignored, same as Gamecast's."""
    payload = _decode_session(websocket.cookies.get(SESSION_COOKIE_NAME))
    if payload is None and ticket:
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="watch_party_ws")
    if payload is None:
        await websocket.close(code=4401)
        return

    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            # require_active_league_id raises HTTPException (409) for a
            # signed-in-but-no-active-league visitor — meaningless in a
            # WS context, so it's translated into a close code here
            # rather than left to propagate as an unhandled exception.
            league_id = await require_active_league_id(conn, payload)
            owner_id = await resolve_owner_id(conn, payload)
            room = await _room_if_accessible(conn, room_id, league_id, owner_id)
            if room is not None:
                # Idempotent, and cheap insurance against this socket
                # ever connecting before the token endpoint's own call —
                # see ensure_conversation_participant's docstring.
                await watch_party_queries.ensure_conversation_participant(conn, room["conversation_id"], owner_id)
    except HTTPException:
        await websocket.close(code=4409)
        return
    if room is None:
        await websocket.close(code=4404)
        return

    await watch_party_manager.connect(room_id, websocket, owner_id)
    try:
        async with pool.acquire() as conn:
            digest = await watch_party_domain.build_fantasy_digest(conn, league_id)
        if digest is not None:
            await websocket.send_json(digest)
        # Where the room's TV is right now, so a newcomer delays the
        # game the same as everyone already in the room.
        await websocket.send_json({
            "type": "tv", "room_id": room_id, "tv_game_id": room["tv_game_id"],
            "tv_delay_seconds": room["tv_delay_seconds"], "set_by_owner_id": room["tv_set_by_owner_id"],
        })

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        watch_party_manager.disconnect(room_id, websocket)
