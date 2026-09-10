"""
A real in-app feedback mechanism — the owner's own request (2026-09-02),
nothing like this existed anywhere in the app before. Deliberately simple
per the owner's own call: store the submission, give a simple page for the
commissioner to check it. No email, no webhook — those are real follow-ups
if this turns out to need them, not built speculatively now.

Any signed-in account (league-less or not) can submit; only a commissioner
of their own active league can list submissions — same "commissioner only"
concept every other admin-ish surface in this app already uses
(app/auth/league_context.py's require_league_commissioner), not a new
authorization concept invented just for this.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool
from app.image_url import validate_blob_image_url

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


class FeedbackRequest(BaseModel):
    message: str
    page_url: str | None = None
    # A screenshot attached via the same Vercel Blob upload flow chat
    # images use (frontend/src/app/api/chat/upload/route.ts — one Blob
    # store for the whole app, see app/image_url.py's own docstring),
    # not a new upload path built just for this. Validated the same way
    # a chat message's image_url is: silently dropped rather than
    # erroring, if it doesn't actually point at our own Blob store.
    image_url: str | None = None


@router.post("")
async def submit_feedback(body: FeedbackRequest, request: Request):
    message = body.message.strip()
    image_url = validate_blob_image_url(body.image_url)
    if not message and not image_url:
        raise HTTPException(status_code=400, detail="Feedback message can't be empty")

    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Same owner-then-users display-name fallback GET /auth/me
        # already uses (routers/auth.py) — a password account with no
        # owner link yet still gets a real name attached, not "Unknown".
        submitted_by = None
        if payload.get("owner_id") is not None:
            owner = await conn.fetchrow(
                "SELECT display_name FROM owners WHERE owner_id = $1", payload["owner_id"]
            )
            submitted_by = owner["display_name"] if owner else None
        if submitted_by is None:
            user = await conn.fetchrow(
                "SELECT display_name FROM users WHERE id = $1", payload["user_id"]
            )
            submitted_by = user["display_name"] if user else None
        if submitted_by is None:
            submitted_by = "Unknown"

        await conn.execute(
            "INSERT INTO feedback (user_id, submitted_by, message, page_url, image_url) VALUES ($1, $2, $3, $4, $5)",
            payload["user_id"], submitted_by, message, body.page_url, image_url,
        )
    return {"status": "ok"}


@router.get("")
async def list_feedback(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_league_commissioner(conn, payload)
        rows = await conn.fetch(
            "SELECT id, submitted_by, message, page_url, image_url, created_at "
            "FROM feedback ORDER BY created_at DESC LIMIT 200"
        )
    return {"items": [dict(r) for r in rows]}
