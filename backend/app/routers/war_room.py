"""The War Room (2026-10-27) — My Team's draft and keepers in one tab;
see app/domain/war_room.py. Reads and the nudge both resolve the league
and owner from the session, never the client."""
from datetime import date

from fastapi import APIRouter, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, resolve_owner_id
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain import war_room
from app.notifications import dispatcher, formatter
from app.notifications.game_alerts import claim_once
from app.queries import owner_preferences as preferences_queries

router = APIRouter(prefix="/war-room", tags=["war-room"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.get("")
async def get_war_room(request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        if owner_id is None:
            raise HTTPException(status_code=404, detail="You don't have a team in this league")
        return await war_room.get_war_room(conn, season, league_id, owner_id)


@router.post("/keeper-nudge")
async def nudge_keepers(request: Request):
    """Pushes everyone who hasn't finished their keepers. Once a day per
    league, whoever sends it."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        targets = await war_room.nudge_keepers(conn, season, league_id, owner_id)
        if not targets:
            raise HTTPException(status_code=409, detail="Nobody's waiting on keepers right now")
        if not await claim_once(conn, f"keeper-nudge:{league_id}:{season}:{date.today().isoformat()}"):
            raise HTTPException(status_code=429, detail="Someone already nudged everyone today")
        sender = await conn.fetchval(
            "SELECT COALESCE(goes_by, display_name) FROM owners WHERE owner_id = $1", owner_id
        )
        push = formatter.keeper_nudge(sender or "Your league")
        for target in targets:
            prefs = await preferences_queries.get_preferences(conn, target)
            if prefs["push_enabled"]:
                await dispatcher.send_to_owner(conn, target, push)
    return {"nudged": len(targets)}
