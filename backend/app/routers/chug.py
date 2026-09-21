"""
Chug leaderboard + Chug Analyzer upload endpoints. Every signed-in
owner is already verified against the league (see app/routers/auth.py),
so a successful upload immediately pays down that owner's real
outstanding chug debt (app/domain/chug_standing.py's record_completed_chug)
with no separate "mark complete" step — a real chug posted with nothing
owed still counts toward lifetime_completed, just with no debt effect
(the "for funsies" case, an explicit product decision).
"""
import asyncio
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.auth.config import SessionConfig
from app.auth.league_context import (
    require_active_league_id,
    require_league_access,
    require_league_commissioner,
    resolve_owner_id,
)
from app.auth.session import decode_session_token, get_session_token, decode_ticket_token
from app.config import _require
from app.db import get_pool
from app.domain.chug_deadline import deadline_from_week_games, get_mnf_deadline, is_past_mnf_deadline
from app.domain.chug_leaderboard import build_chug_leaderboard
from app.domain.chug_standing import clear_fine, record_completed_chug, record_manual_payment, undo_week
from app.notifications.chug_events import notify_chug_posted
from app.providers import chug_storage
from app.providers.chug_analyzer_bridge import run_chug_analysis
from app.providers.nfl_scoreboard import get_nfl_scoreboard, get_week_scoreboard
from app.queries import chug as chug_queries
from app.queries import league as league_queries

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

router = APIRouter(prefix="/chug", tags=["chug"])

# Same three extensions the Discord bot's chug_watcher.py looked for.
VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v")
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # a modern phone's 4K clip can be 100MB+ for a few seconds
# Comfortably under Railway's real 5-minute no-data-transferred cutoff
# (see upload_chug's own docstring) — a module-level constant so tests
# can shrink it rather than actually waiting on the real interval.
UPLOAD_HEARTBEAT_SECONDS = 20


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
async def chug_leaderboard(
    season: int | None = None, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Who owes/has paid real chug fines — genuinely private, socially
    and financially sensitive per-league data. Used to fall back to
    League 1's real leaderboard for a signed-out visitor or any signed-
    in-but-not-a-member account via resolve_active_league_id's public
    fallback (2026-09 audit, same root cause as league.py's — see that
    router's module docstring); now requires real membership like
    everything else league-private."""
    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        leaderboard = await build_chug_leaderboard(conn, active_season, season, league_id)
    return {"season": season, "leaderboard": leaderboard}


@router.get("/feed")
async def chug_feed(
    season: int | None = None, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    """Individual graded chugs, newest first — the "Recent Chugs" list,
    distinct from /chug/leaderboard's per-owner season totals. Videos
    aren't included directly (has_video just says whether one exists);
    a viewer fetches a playable URL per-chug from GET /chug/{id}/video
    only once they actually open it, so this stays cheap regardless of
    how many chugs have video."""
    async with pool.acquire() as conn:
        rows = await chug_queries.list_recent_chugs(conn, league_id, season)
    return {
        "chugs": [
            {
                "id": r["id"],
                "owner_id": r["owner_id"],
                "owner_name": r["owner_name"],
                "week": r["week"],
                "final_score": r["final_score"],
                "created_at": r["created_at"].isoformat(),
                "has_video": r["has_video"],
            }
            for r in rows
        ]
    }


@router.get("/{chug_id}/video")
async def chug_video(chug_id: int, league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """Exchanges a chug's stored object key for a short-lived presigned
    URL, after proving the requester is a real member of the league
    this chug belongs to — chug_queries.get_chug_video_key scopes the
    lookup by league_id so guessing another league's chug id never
    works. The presigned URL itself (not this endpoint) is what the
    frontend's <video> tag actually plays from — see
    app/providers/chug_storage.py for why: it supports byte-range
    requests (seeking/scrubbing) natively, which proxying bytes through
    this backend would not."""
    async with pool.acquire() as conn:
        video_key = await chug_queries.get_chug_video_key(conn, chug_id, league_id)
    if video_key is None:
        raise HTTPException(status_code=404, detail="No video for this chug")
    url = await asyncio.to_thread(chug_storage.presigned_video_url, video_key)
    return {"url": url, "expires_in": chug_storage.PRESIGNED_URL_TTL_SECONDS}


@router.get("/deadline")
async def chug_deadline(league_id: int = Depends(require_league_access), pool=Depends(get_pool)):
    """When this week's chugs are due by (Jeffrey's Rule — see
    app/domain/chug_deadline.py) — real ESPN Monday Night Football
    kickoff, not a guessed fixed time. league_id is otherwise unused
    (the deadline itself is the same NFL-wide fact for every league)
    but kept for the same signed-in-with-real-membership gate every
    other /chug endpoint already has, rather than exposing this to
    anyone unauthenticated — it's now also what scopes the has-any-debt
    check below to this league.

    2026-09-12 fix, real report: this used to compute and return a real
    deadline every single week of the season, including before Week 1
    has even finished — chug_debt.py's compute_chug_debts_for_week
    doesn't create the season's first real chug_debts row until the
    first week is_week_final, so a member could see a live countdown
    days before anyone could possibly owe a chug yet. `deadline` is now
    null until at least one row exists in chug_debts for this league/
    season — the same table (and the same "nothing owed yet" concept)
    every other /chug endpoint already reads from.

    2026-09-15 fix, real report: once a week's deadline was actually
    settled, this kept reading get_nfl_scoreboard() — ESPN's own public
    "current week" endpoint, which is stuck on the just-finished week
    until ESPN itself flips it (the same unreliable signal fixed
    elsewhere for narrative/settlement) — and computed a "now"-anchored
    deadline off it, which on a Tue/Wed always resolves to the Monday
    that JUST passed. That showed "chug time" the entire week even
    though the next real deadline was days away. Now prefers this
    league's own cached current_week (already advanced past settlement
    by the week-settlement job) and reads the Monday kickoff straight
    out of THAT week's real schedule."""
    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        any_debt_assigned = await conn.fetchval(
            "SELECT 1 FROM chug_debts WHERE season = $1 AND league_id = $2 LIMIT 1",
            active_season, league_id,
        )
        if not any_debt_assigned:
            return {"deadline": None, "is_past": False}
        cached_week = await league_queries.get_cached_current_week(conn, active_season)

    deadline = None
    if cached_week is not None:
        week_games = await get_week_scoreboard(week=cached_week, year=active_season)
        deadline = deadline_from_week_games(week_games)

    if deadline is not None:
        now_et = datetime.now(_ET)
        return {"deadline": deadline.isoformat(), "is_past": now_et > deadline}

    games = await get_nfl_scoreboard()
    return {"deadline": get_mnf_deadline(games).isoformat(), "is_past": is_past_mnf_deadline(games)}


async def _process_chug_upload(video: UploadFile, payload: dict, pool) -> dict:
    """The real upload+analyze+record work, unchanged from before this
    endpoint became a streaming response — split out so upload_chug's
    heartbeat generator (below) can run it as a background task and
    poll it, rather than blocking on it directly. Raises HTTPException
    on a real failure; the generator catches that and re-encodes it as
    a JSON error line, since an HTTP status code can no longer change
    once a StreamingResponse has already started sending bytes."""
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
                    raise HTTPException(status_code=413, detail="Video too large (500MB max)")
                f.write(chunk)

        try:
            result = await run_chug_analysis(temp_path)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")

        if not result.get("can_to_mouth"):
            return {
                "can_to_mouth": False,
                "message": "Couldn't detect a clear chug in that video — try again with a clearer angle.",
            }

        active_season = int(_require("ACTIVE_SEASON"))
        async with pool.acquire() as conn:
            league_id = await require_active_league_id(conn, payload)
            owner_id = await resolve_owner_id(conn, payload)
            # Real production bug, found live: payload["discord_user_id"] is
            # the JWT's own claim, which is ONLY ever populated by the
            # Discord OAuth login path (app/routers/auth.py's discord_
            # callback) — password and Google login both mint a token with
            # discord_user_id=None, even when that account's owners row has
            # a real one linked from a past Discord login. chug_scores.
            # discord_user_id is NOT NULL (the whole chug leaderboard is
            # still keyed on it — a real, separate design debt, not fixed
            # here), so any owner who happens to be signed in via password/
            # Google when they upload got a raw, unexplained failure — "for
            # funsies," reported directly. Resolved live from the owner's
            # real row instead of trusting the token's claim, same fix
            # already applied to owner_id/is_commissioner elsewhere.
            owner_row = await conn.fetchrow(
                "SELECT discord_user_id, display_name FROM owners WHERE owner_id = $1", owner_id
            )
            discord_user_id = owner_row["discord_user_id"] if owner_row else None
            if discord_user_id is None:
                raise HTTPException(
                    status_code=409,
                    detail="This account needs to be linked to Discord before posting a chug — ask your commissioner.",
                )
            week = await league_queries.get_cached_current_week(conn, active_season)

            # Uploaded (if storage is configured) before the DB insert so
            # the row's video_url is set in the same write, rather than a
            # second UPDATE after the fact. A storage failure here never
            # blocks the chug from being scored/recorded — the grade and
            # debt payoff are the part that actually matters; the video is
            # a bonus that degrades to "no video" the same way it always
            # has when storage isn't configured at all (see
            # app/providers/chug_storage.py's chug_storage_configured()).
            video_key = None
            if chug_storage.chug_storage_configured():
                video_key = chug_storage.object_key(league_id, active_season, week, uuid.uuid4().hex, ext)
                try:
                    await asyncio.to_thread(chug_storage.upload_video, temp_path, video_key, ext)
                except Exception:
                    logger.exception("Failed to upload chug video to storage (key=%s)", video_key)
                    video_key = None

            row = await chug_queries.insert_chug_score(
                conn, discord_user_id, active_season, week,
                result["duration_seconds"], result["smoothness_score"], result["hype_score"], result["final"],
                league_id, video_key,
            )

            owed_before = await conn.fetchval(
                "SELECT outstanding_owed FROM chug_standing WHERE season = $1 AND owner_id = $2 AND league_id = $3",
                active_season, owner_id, league_id,
            ) or 0
            await record_completed_chug(conn, active_season, owner_id, league_id)
            owed_after = await conn.fetchval(
                "SELECT outstanding_owed FROM chug_standing WHERE season = $1 AND owner_id = $2 AND league_id = $3",
                active_season, owner_id, league_id,
            ) or 0

            # Best-effort, after the chug is fully recorded — a push
            # failure here must never affect the grade/debt result
            # already returned to the uploader (see chug_events.py's
            # own docstring).
            await notify_chug_posted(
                conn, active_season, league_id, owner_id, owner_row["display_name"], result["final"],
                video_key is not None,
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
            "has_video": video_key is not None,
            # Did this chug actually pay down a real debt, or was it "for
            # funsies" (nothing owed)? owed_before/after let the frontend
            # say which, instead of guessing.
            "chugs_owed_before": owed_before,
            "chugs_owed_after": owed_after,
        }
    finally:
        # The upload above reads temp_path via a subprocess call and
        # boto3's own upload_file — both finish before this runs, so
        # it's always safe to clean up here regardless of which path
        # through the try block was taken.
        os.remove(temp_path)


@router.post("/upload")
async def upload_chug(
    request: Request, video: UploadFile = File(...), ticket: str | None = None, pool=Depends(get_pool)
):
    """A real 2026-09 incident: a chug upload+analysis can run long
    enough — a slow mobile upload, or a longer video's analysis — to
    hit Railway's real "closes the connection after 5 minutes with no
    data transferred" limit (see docs.railway.com/guides/
    ai-chatbot-streaming#streaming-and-railways-request-timeouts).
    Nothing was ever sent back to the browser until the very end, so a
    slow-but-otherwise-fine upload looked completely idle to Railway's
    edge for however long the real work took — reported client-side as
    a generic "Load failed," not a clean HTTP error, because the
    connection was killed mid-flight rather than the server ever
    getting the chance to respond.

    Streamed as newline-delimited text instead: a single space every
    ~20s while the real work (_process_chug_upload) is still running,
    keeping the connection provably non-idle regardless of how long
    upload+analysis actually takes (bounded only by Railway's separate,
    much longer 15-minute absolute cap), then one final line — the real
    JSON result, exactly the same shape this endpoint always returned —
    once it's done. ChugUpload.tsx reads the whole body as text and
    parses just the last non-blank line.
    """
    payload = _decode_session(get_session_token(request))
    if payload is None and ticket:
        # Same fallback as chat_ws — a direct browser->backend upload
        # is a cross-site request just like the WebSocket handshake,
        # so it hits the same Safari ITP cookie-blocking problem. See
        # app/auth/session.py and /auth/ticket in app/routers/auth.py.
        config = SessionConfig()
        payload = decode_ticket_token(config.session_secret, ticket, expected_purpose="chug_upload")
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    async def stream():
        task = asyncio.ensure_future(_process_chug_upload(video, payload, pool))
        while not task.done():
            _, pending = await asyncio.wait({task}, timeout=UPLOAD_HEARTBEAT_SECONDS)
            if pending:
                yield " "
        try:
            result = await task
            yield "\n" + json.dumps(result)
        except HTTPException as e:
            yield "\n" + json.dumps({"can_to_mouth": False, "error": True, "status": e.status_code, "message": e.detail})

    return StreamingResponse(stream(), media_type="text/plain")


@router.post("/standing/{owner_id}/clear-fine")
async def clear_chug_fine(owner_id: int, request: Request, amount: int | None = None, pool=Depends(get_pool)):
    """Commissioner-only: marks a real-life fine payment by reducing
    fined_owed. A fined chug can only ever be cleared this way — never
    by completing a real chug (see app/domain/chug_standing.py) — so
    this is deliberately not self-serve."""
    payload = _decode_session(get_session_token(request))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        cleared = await clear_fine(conn, active_season, owner_id, amount, league_id)

    return {"owner_id": owner_id, "cleared": cleared}


@router.post("/standing/{owner_id}/record-payment")
async def record_chug_payment(owner_id: int, request: Request, amount: int = 1, pool=Depends(get_pool)):
    """Commissioner-only: marks a real chug debt as settled outside the
    app -- paid in cash, or done in person with no video kept. The only
    other path (besides a real video clearing /chug/upload) that can
    reduce outstanding_owed; deliberately separate from clear-fine,
    which only ever touches fined_owed. Before the MNF deadline, this
    matters beyond bookkeeping: settle_deadline_for_week doubles
    whatever's still outstanding at kickoff, so an off-app payment that
    never gets recorded here looks identical to a missed week and gets
    doubled regardless of whether it was actually paid."""
    payload = _decode_session(get_session_token(request))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        applied = await record_manual_payment(conn, active_season, owner_id, amount, league_id)

    return {"owner_id": owner_id, "applied": applied}


@router.post("/standing/undo-week")
async def undo_chug_week(week: int, request: Request, pool=Depends(get_pool)):
    """Commissioner-only correction tool: reverses one week's auto-
    computed chug debt entirely — every owner's running balance is
    rolled back by exactly what that week added, and the week's
    chug_debts/chug_debt_accruals rows are removed. For a week that got
    computed against data that wasn't real yet (e.g. a manual sync run
    before that week's actual games were played, where every honest
    0-point score got misread as a chug-worthy zero — see
    app/domain/chug_standing.py's undo_week docstring for the real
    2026-09 incident this was built for)."""
    payload = _decode_session(get_session_token(request))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    active_season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        reverted = await undo_week(conn, active_season, week, league_id)

    return {"season": active_season, "week": week, "owners_reverted": reverted}
