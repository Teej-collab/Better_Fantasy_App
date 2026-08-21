"""
Self-serve user settings — display name and chat bubble color. Every
route resolves the current owner from the session cookie only, the same
pattern as /auth/me and /me/week (app/routers/auth.py, app/routers/me.py)
— there is deliberately no owner_id path/body parameter anywhere here,
so there is no request shape that could ever let a signed-in owner
write another owner's row. GET is the only unauthenticated-safe
operation and still requires a session (settings are private to the
owner who set them, not a public directory).

chat_color is validated strictly here (hex only) before it ever reaches
the database — this value is used in an actual CSS context on the
frontend (a chat bubble's inline background color), so unlike most
free-text fields in this app, a malformed or adversarial value here has
a real (if narrow — React's style prop, not string-interpolated CSS/HTML)
downstream effect, not just a cosmetic one. Reject rather than sanitize:
this is a small, low-stakes field with an unambiguous valid format, so
there's no reason to guess at what the user "meant."
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.db import get_pool
from app.queries import settings as settings_queries

router = APIRouter(prefix="/settings", tags=["settings"])

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_DISPLAY_NAME_MAX_LENGTH = 40


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.get("/me")
async def get_my_settings(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        row = await settings_queries.get_settings(conn, payload["owner_id"])
    if row is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    return dict(row)


class DisplayNameBody(BaseModel):
    display_name: str


@router.put("/display-name")
async def update_display_name(body: DisplayNameBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)

    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Display name can't be empty")
    if len(name) > _DISPLAY_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Display name must be {_DISPLAY_NAME_MAX_LENGTH} characters or fewer")
    if any(ord(c) < 32 for c in name):
        raise HTTPException(status_code=400, detail="Display name can't contain control characters")

    async with pool.acquire() as conn:
        await settings_queries.set_display_name(conn, payload["owner_id"], name)
    return {"display_name": name}


@router.post("/display-name/reset")
async def reset_display_name(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        await settings_queries.reset_display_name(conn, payload["owner_id"])
        row = await settings_queries.get_settings(conn, payload["owner_id"])
    return {"display_name": row["display_name"]}


class ChatColorBody(BaseModel):
    chat_color: str | None = None


@router.put("/chat-color")
async def update_chat_color(body: ChatColorBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)

    color = body.chat_color
    if color is not None and not _HEX_COLOR_RE.match(color):
        raise HTTPException(status_code=400, detail="chat_color must be a 6-digit hex color like #39ff6a, or null")

    async with pool.acquire() as conn:
        await settings_queries.set_chat_color(conn, payload["owner_id"], color)
    return {"chat_color": color}
