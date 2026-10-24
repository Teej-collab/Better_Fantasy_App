"""
The 2027 waitlist (2026-10-24): the public /waitlist page's signup, and
the admin's list of who signed up. No account needed to sign up — this
is for people who haven't seen the app yet. One row per email; signing
up again updates it.

Rate-limited like signup (app/auth/rate_limit.py): per email and,
loosely, per IP.
"""
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.config import SessionConfig
from app.auth.league_context import require_site_admin
from app.auth.rate_limit import check_login_or_signup_rate_limit
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool

router = APIRouter(tags=["waitlist"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistSignup(BaseModel):
    email: str = Field(max_length=254)
    name: str | None = Field(default=None, max_length=80)
    role: Literal["commissioner", "player"] = "commissioner"
    league_size: int | None = Field(default=None, ge=2, le=32)
    platform: Literal["espn", "sleeper", "yahoo", "nfl", "other", "none"] | None = None
    note: str | None = Field(default=None, max_length=500)
    ref: str | None = Field(default=None, max_length=40)


@router.post("/waitlist")
async def join_waitlist(body: WaitlistSignup, request: Request, pool=Depends(get_pool)):
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(status_code=400, detail="That doesn't look like an email address.")
    check_login_or_signup_rate_limit("waitlist", email, request.client.host if request.client else None)
    ref = re.sub(r"[^a-z0-9_-]", "", (body.ref or "").lower())[:40] or None
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO waitlist_signups (email, name, role, league_size, platform, note, ref)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (lower(email)) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, waitlist_signups.name),
                role = EXCLUDED.role,
                league_size = COALESCE(EXCLUDED.league_size, waitlist_signups.league_size),
                platform = COALESCE(EXCLUDED.platform, waitlist_signups.platform),
                note = COALESCE(EXCLUDED.note, waitlist_signups.note),
                ref = COALESCE(waitlist_signups.ref, EXCLUDED.ref),
                updated_at = now()
            """,
            email, (body.name or "").strip() or None, body.role, body.league_size, body.platform,
            (body.note or "").strip() or None, ref,
        )
    return {"ok": True}


@router.get("/admin/waitlist")
async def list_waitlist(request: Request, pool=Depends(get_pool)):
    payload = decode_session_token(SessionConfig().session_secret, get_session_token(request) or "")
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    async with pool.acquire() as conn:
        await require_site_admin(conn, payload)
        rows = await conn.fetch(
            "SELECT id, email, name, role, league_size, platform, note, ref, created_at FROM waitlist_signups "
            "ORDER BY created_at DESC"
        )
    signups = [dict(r) for r in rows]
    return {
        "count": len(signups),
        "commissioners": sum(1 for s in signups if s["role"] == "commissioner"),
        "players_represented": sum(s["league_size"] or 0 for s in signups if s["role"] == "commissioner"),
        "signups": signups,
    }
