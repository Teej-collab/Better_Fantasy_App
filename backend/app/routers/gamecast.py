"""
Live NFL Gamecast — REST for initial page load/discovery, one
WebSocket per client for live updates after that. Mirrors app/routers/
chat.py's split (REST for state that's fine to server-render once,
WS for the stuff that actually changes in real time) and its exact
session-cookie-or-ticket-token WS auth fallback for the same reason:
this is a cross-site-ish request from the frontend's own domain to
this API, same Safari ITP cookie-blocking concern chat's WS already
solved for. Reuses the existing "ws" ticket purpose (app/routers/
auth.py's TICKET_PURPOSES) rather than minting a new one — the ticket
only ever proves "this is a real signed-in session for a websocket
handshake," nothing about its purpose string is chat-specific.
"""
import json

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, get_session_token, decode_ticket_token
from app.db import get_pool
from app.gamecast import service
from app.gamecast.manager import manager
from app.gamecast.providers import get_nfl_data_provider

router = APIRouter(prefix="/nfl", tags=["gamecast"])


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


@router.get("/live-games")
async def live_games():
    provider = get_nfl_data_provider()
    games = await provider.list_live_games()
    return {"games": [g.model_dump(mode="json") for g in games]}


@router.get("/games/{game_id}")
async def game_state(game_id: str):
    cached = service.get_cached_state(game_id)
    if cached is not None:
        return cached.model_dump(mode="json")

    # Cache miss — either nobody's polled this game yet (scheduler off,
    # or this is the very first request) or it's an unknown id. Fetch
    # once on-demand so a direct page load never has to wait for the
    # next scheduler tick just to see something.
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            game, _events = await service.refresh_game(conn, game_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown game_id")
    return game.model_dump(mode="json")


@router.get("/games/{game_id}/fantasy-impact")
async def game_fantasy_impact(game_id: str, request: Request):
    """Real fantasy-point data for the "Fantasy Impact" panel — see
    service.build_fantasy_impact's own docstring. Polled on an interval
    by the frontend (real fantasy_points only ever change on the
    scheduler's own poll cadence, not play-by-play, so a WS push here
    would be over-engineering for how often this actually moves)
    rather than pushed over the existing gamecast WS, which carries
    play-by-play/score state, not this. Never requires sign-in — an
    anonymous visitor still gets game_leaders (real, league-independent
    top scorers), just no your_players/opponent_players section."""
    game = service.get_cached_state(game_id)
    pool = await get_pool()
    if game is None:
        try:
            async with pool.acquire() as conn:
                game, _events = await service.refresh_game(conn, game_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Unknown game_id")

    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    async with pool.acquire() as conn:
        return await service.build_fantasy_impact(conn, game, payload)


@router.websocket("/gamecast/ws")
async def gamecast_ws(websocket: WebSocket, game_id: str, ticket: str | None = None):
    payload = _decode_session(websocket.cookies.get(SESSION_COOKIE_NAME))
    if payload is None and ticket:
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="ws")
    if payload is None:
        await websocket.close(code=4401)
        return

    await manager.connect(game_id, websocket)
    try:
        cached = service.get_cached_state(game_id)
        if cached is None:
            pool = await get_pool()
            try:
                async with pool.acquire() as conn:
                    cached, _events = await service.refresh_game(conn, game_id)
            except KeyError:
                await websocket.send_json({"type": "error", "detail": "Unknown game_id"})
                await websocket.close(code=4404)
                return
        await websocket.send_json({"type": "game_state", "game": cached.model_dump(mode="json")})

        # This socket only ever receives — there's nothing a client
        # needs to send Gamecast (unlike chat's typing indicators/
        # messages). receive_text() here exists purely to detect
        # disconnects; any inbound payload is ignored.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(game_id, websocket)
