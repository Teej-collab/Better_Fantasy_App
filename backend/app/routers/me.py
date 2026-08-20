"""
Session-aware "my stuff" endpoints — currently just the homepage hero
(app/domain/your_week.py). Same cookie-decode pattern as /auth/me
(app/routers/auth.py); kept separate since this is homepage/dashboard
data, not identity itself.
"""
from fastapi import APIRouter, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain.your_week import build_your_week

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/week")
async def week(request: Request):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")

    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    active_season = int(_require("ACTIVE_SEASON"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await build_your_week(conn, payload["owner_id"], active_season)

    if result is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return result
