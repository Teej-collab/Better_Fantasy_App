"""
Chug leaderboard + Chug Analyzer upload endpoints. Every signed-in
owner is already verified against the league (see app/routers/auth.py),
so a successful upload immediately pays down that owner's real
outstanding chug debt (app/domain/chug_standing.py's record_completed_chug)
with no separate "mark complete" step — a real chug posted with nothing
owed still counts toward lifetime_completed, just with no debt effect
(the "for funsies" case, an explicit product decision).
"""
import os
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token, decode_ticket_token
from app.config import DEFAULT_LEAGUE_ID, _require
from app.db import get_pool
from app.domain.chug_leaderboard import build_chug_leaderboard
from app.domain.chug_standing import clear_fine, record_completed_chug
from app.providers.chug_analyzer_bridge import run_chug_analysis
from app.queries import chug as chug_queries
from app.queries import league as league_queries

router = APIRouter(prefix="/chug", tags=["chug"])

# Same three extensions the Discord bot's chug_watcher.py looked for.
VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v")
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # generous for a phone-shot clip a few seconds long


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


@router.get("/seasons")
async def chug_seasons(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await chug_queries.list_chug_seasons(conn)
    return {"seasons": [r["season"] for r in rows]}


@router.get("/leaderboard")
async def chug_leaderboard(season: int | None = None, pool=Depends(get_pool)):
    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        leaderboard = await build_chug_leaderboard(conn, active_season, season)
    return {"season": season, "leaderboard": leaderboard}


@router.post("/upload")
async def upload_chug(
    request: Request, video: UploadFile = File(...), ticket: str | None = None, pool=Depends(get_pool)
):
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    if payload is None and ticket:
        # Same fallback as chat_ws — a direct browser->backend upload
        # is a cross-site request just like the WebSocket handshake,
        # so it hits the same Safari ITP cookie-blocking problem. See
        # app/auth/session.py and /auth/ticket in app/routers/auth.py.
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="chug_upload")
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    ext = os.path.splitext(video.filename or "")[1].lower()
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type — expected one of {VIDEO_EXTENSIONS}")

    fd, temp_path = tempfile.mkstemp(suffix=ext)
    try:
        with os.fdopen(fd, "wb") as f:
            total = 0
            while chunk := await video.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Video too large (100MB max)")
                f.write(chunk)

        try:
            result = await run_chug_analysis(temp_path)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")
    finally:
        # Never persisted — same as the original Discord bot, which
        # deletes the temp file right after scoring rather than hosting
        # it anywhere.
        os.remove(temp_path)

    if not result.get("can_to_mouth"):
        return {
            "can_to_mouth": False,
            "message": "Couldn't detect a clear chug in that video — try again with a clearer angle.",
        }

    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        week = await league_queries.get_cached_current_week(conn, active_season)
        row = await chug_queries.insert_chug_score(
            conn, payload["discord_user_id"], active_season, week,
            result["duration_seconds"], result["smoothness_score"], result["hype_score"], result["final"],
        )

        owed_before = await conn.fetchval(
            "SELECT outstanding_owed FROM chug_standing WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            active_season, payload["owner_id"], DEFAULT_LEAGUE_ID,
        ) or 0
        await record_completed_chug(conn, active_season, payload["owner_id"])
        owed_after = await conn.fetchval(
            "SELECT outstanding_owed FROM chug_standing WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            active_season, payload["owner_id"], DEFAULT_LEAGUE_ID,
        ) or 0

    return {
        "can_to_mouth": True,
        "id": row["id"],
        "duration_seconds": result["duration_seconds"],
        "time_score": result["time_score"],
        "smoothness_score": result["smoothness_score"],
        "hype_score": result["hype_score"],
        "final_score": result["final"],
        "created_at": row["created_at"].isoformat(),
        # Did this chug actually pay down a real debt, or was it "for
        # funsies" (nothing owed)? owed_before/after let the frontend
        # say which, instead of guessing.
        "chugs_owed_before": owed_before,
        "chugs_owed_after": owed_after,
    }


@router.post("/standing/{owner_id}/clear-fine")
async def clear_chug_fine(owner_id: int, request: Request, amount: int | None = None, pool=Depends(get_pool)):
    """Commissioner-only: marks a real-life fine payment by reducing
    fined_owed. A fined chug can only ever be cleared this way — never
    by completing a real chug (see app/domain/chug_standing.py) — so
    this is deliberately not self-serve."""
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    if not payload.get("is_commissioner"):
        raise HTTPException(status_code=403, detail="Commissioner only")

    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        cleared = await clear_fine(conn, active_season, owner_id, amount)

    return {"owner_id": owner_id, "cleared": cleared}
