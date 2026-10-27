"""Suggested rivalries (2026-10-27) — see app/domain/rivalry_detection.py.
Commissioner-only: listing refreshes the suggestions from the league's
history first, then the commissioner approves (with a name and tagline
they can edit) or dismisses each one."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool
from app.domain import commish_log, rivalry_detection

router = APIRouter(prefix="/leagues", tags=["rivalries"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.get("/{league_id}/rivalry-suggestions")
async def list_suggestions(league_id: int, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        await rivalry_detection.refresh_suggestions(conn, league_id)
        suggestions = await rivalry_detection.list_pending(conn, league_id)
    return {"suggestions": suggestions}


class ApproveBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    tagline: str | None = Field(default=None, max_length=200)


@router.post("/{league_id}/rivalry-suggestions/{suggestion_id}/approve")
async def approve_suggestion(league_id: int, suggestion_id: int, body: ApproveBody, request: Request):
    payload = _require_session(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the rivalry a name.")
    tagline = (body.tagline or "").strip() or None
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        try:
            rivalry = await rivalry_detection.approve(conn, league_id, suggestion_id, payload["user_id"], name, tagline)
        except rivalry_detection.SuggestionNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except rivalry_detection.RivalryExistsError as e:
            raise HTTPException(status_code=409, detail=str(e))
        await commish_log.record(conn, league_id, payload["user_id"], "rivalries", f"Made a rivalry official: {name}")
    return {"rivalry": rivalry}


@router.post("/{league_id}/rivalry-suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(league_id: int, suggestion_id: int, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        try:
            await rivalry_detection.dismiss(conn, league_id, suggestion_id, payload["user_id"])
        except rivalry_detection.SuggestionNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True}
