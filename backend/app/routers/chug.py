"""
Chug leaderboard + Chug Analyzer upload endpoints. Deliberately doesn't
yet include the self-serve "mark complete"/weekly-status flow
(chug_weekly_status) — see TODO.md; completion is derived live from
chug_scores instead (app/domain/chug_leaderboard.py), so an uploaded
video is immediately reflected there with no separate step.
"""
import os
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain.chug_leaderboard import build_chug_leaderboard
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
async def upload_chug(request: Request, video: UploadFile = File(...), pool=Depends(get_pool)):
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
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

    return {
        "can_to_mouth": True,
        "id": row["id"],
        "duration_seconds": result["duration_seconds"],
        "time_score": result["time_score"],
        "smoothness_score": result["smoothness_score"],
        "hype_score": result["hype_score"],
        "final_score": result["final"],
        "created_at": row["created_at"].isoformat(),
    }
