"""Scoring rules for the caller's own active league — read access is
open to any member (matches keepers.py's own /me read precedent), the
write is commissioner-only. Mirrors keepers.py's shape exactly:
league_id is always resolved from the session's active league, never
accepted from the request itself.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.queries import leagues as league_queries

router = APIRouter(prefix="/league", tags=["league-settings"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


@router.get("/scoring-rules")
async def get_scoring_rules(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rows = await league_queries.get_scoring_rules(conn, league_id, season)
    return {"season": season, "rules": [dict(r) for r in rows]}


class ScoringRulesRequest(BaseModel):
    season: int
    rules: dict[str, float]


@router.put("/scoring-rules")
async def update_scoring_rules(body: ScoringRulesRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await league_queries.upsert_scoring_rules(conn, league_id, body.season, body.rules)
        rows = await league_queries.get_scoring_rules(conn, league_id, body.season)
    return {"season": body.season, "rules": [dict(r) for r in rows]}
