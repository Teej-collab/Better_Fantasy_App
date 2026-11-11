"""
Public share links (2026-11-10, the share overhaul). A member shares a
matchup, recap, standings, power rankings or a week's awards and gets
an unguessable link anyone can open without signing in: the web's card
images (frontend/src/app/s/[token]/image) and public page
(frontend/src/app/s/[token]) read the card through GET /share/{token}.
Sharing the same thing again hands back the same link.

The card itself only carries what's drawn on it (app/domain/
share_cards.py): this is the one deliberately public read of league
data, and only for something a member chose to share.
"""
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_league_access
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool
from app.domain import share_cards

router = APIRouter(prefix="/share", tags=["share"])

# The fields each kind's ref keeps, so one shared thing has one link.
_REF_FIELDS = {
    "matchup": ("matchup_id",),
    "recap": ("season", "week"),
    "standings": ("season",),
    "power": ("season", "week"),
    "awards": ("season", "week"),
}


class ShareRequest(BaseModel):
    kind: str
    matchup_id: int | None = None
    season: int | None = None
    week: int | None = None


@router.post("")
async def create_share_link(
    body: ShareRequest, request: Request, league_id: int = Depends(require_league_access), pool=Depends(get_pool)
):
    if body.kind not in _REF_FIELDS:
        raise HTTPException(status_code=422, detail="Can't share that.")
    values = body.model_dump()
    if any(values[f] is None for f in _REF_FIELDS[body.kind]):
        raise HTTPException(status_code=422, detail=f"Sharing {body.kind} needs {', '.join(_REF_FIELDS[body.kind])}.")
    ref = {f: values[f] for f in _REF_FIELDS[body.kind]}
    payload = decode_session_token(SessionConfig().session_secret, get_session_token(request) or "")

    async with pool.acquire() as conn:
        # Only something that exists in this league, and has something to show.
        if await share_cards.BUILDERS[body.kind](conn, league_id, ref) is None:
            raise HTTPException(status_code=404, detail="There's nothing to share here yet.")
        token = await conn.fetchval(
            """
            INSERT INTO share_links (token, league_id, kind, ref, created_by)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            ON CONFLICT (league_id, kind, ref) DO UPDATE SET kind = EXCLUDED.kind
            RETURNING token
            """,
            secrets.token_urlsafe(8), league_id, body.kind, json.dumps(ref), payload["user_id"] if payload else None,
        )
    return {"token": token}


@router.get("/{token}")
async def read_share_link(token: str, pool=Depends(get_pool)):
    """Public: the card behind a share link, built live."""
    async with pool.acquire() as conn:
        link = await conn.fetchrow(
            """
            UPDATE share_links SET views = views + 1 WHERE token = $1
            RETURNING league_id, kind, ref, (SELECT name FROM leagues WHERE id = share_links.league_id) AS league_name
            """,
            token,
        )
        if link is None:
            raise HTTPException(status_code=404, detail="That link doesn't go anywhere.")
        card = await share_cards.BUILDERS[link["kind"]](conn, link["league_id"], json.loads(link["ref"]) if isinstance(link["ref"], str) else link["ref"])
    if card is None:
        raise HTTPException(status_code=404, detail="Nothing to show here yet.")
    return {"kind": link["kind"], "league_name": link["league_name"], "card": card}
