"""
Player card — headshot, bio, and real ESPN season/weekly point
projections + ownership% + bye week for a single player (see
app/domain/player_card.py). Signed-in only, same discipline as the
rest of the roster/draft/free-agent read paths, but not owner-scoped —
this is a read-only lookup against this league's real ESPN data and
this app's own Sleeper-sourced player table, identical for any signed-
in owner, so no owner_id is resolved here the way me.py/keepers.py do.
"""
from fastapi import APIRouter, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.db import get_pool
from app.domain.player_card import get_player_card

router = APIRouter(prefix="/players", tags=["players"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


@router.get("/{sleeper_player_id}/card")
async def player_card(sleeper_player_id: str, request: Request):
    _require_session(request)

    pool = await get_pool()
    async with pool.acquire() as conn:
        card = await get_player_card(conn, sleeper_player_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return card
