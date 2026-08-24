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
import datetime
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.db import get_pool
from app.queries import owner_preferences as preferences_queries
from app.queries import settings as settings_queries

router = APIRouter(prefix="/settings", tags=["settings"])

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_DISPLAY_NAME_MAX_LENGTH = 40

# The homepage's six reorderable dashboard cards (see (home)/page.tsx's
# HomeCardDeck) — home_card_order stores a JSON array drawn from this
# set. Validated here, not just trusted from the client, since a
# malformed value would otherwise silently break the homepage for
# whoever's account it landed on.
_VALID_HOME_CARD_KEYS = {"yourWeek", "standings", "matchups", "rivalries", "awards", "discover"}


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
        raise HTTPException(status_code=400, detail="chat_color must be a 6-digit hex color like #39ff14, or null")

    async with pool.acquire() as conn:
        await settings_queries.set_chat_color(conn, payload["owner_id"], color)
    return {"chat_color": color}


@router.get("/preferences")
async def get_preferences(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        return await preferences_queries.get_preferences(conn, payload["owner_id"])


class PreferencesPatch(BaseModel):
    """Every field optional — only fields actually present in the
    request body (model_dump(exclude_unset=True) below) get applied,
    so a client can PATCH a single toggle without resending the rest.
    sunday_mode is deliberately not settable here — only through
    POST /preferences/sunday-mode below, which also enforces it's one
    of the three real presets."""

    notify_direct_messages: bool | None = None
    notify_league_chat: bool | None = None
    notify_mentions: bool | None = None
    notify_replies: bool | None = None
    quiet_hours_enabled: bool | None = None
    quiet_hours_start: datetime.time | None = None
    quiet_hours_end: datetime.time | None = None
    read_receipts_enabled: bool | None = None
    typing_indicators_enabled: bool | None = None
    message_previews_enabled: bool | None = None
    mention_highlighting_enabled: bool | None = None
    neon_intensity: str | None = None
    reduced_motion: bool | None = None
    accent_color: str | None = None
    home_card_order: str | None = None


_VALID_NEON_INTENSITIES = {"subtle", "standard", "high"}


@router.put("/preferences")
async def update_preferences(body: PreferencesPatch, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)

    patch = body.model_dump(exclude_unset=True)
    if "neon_intensity" in patch and patch["neon_intensity"] not in _VALID_NEON_INTENSITIES:
        raise HTTPException(status_code=400, detail=f"neon_intensity must be one of {sorted(_VALID_NEON_INTENSITIES)}")
    if patch.get("accent_color") is not None and not _HEX_COLOR_RE.match(patch["accent_color"]):
        raise HTTPException(status_code=400, detail="accent_color must be a 6-digit hex color like #39ff14, or null")
    if patch.get("home_card_order") is not None:
        try:
            order = json.loads(patch["home_card_order"])
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(status_code=400, detail="home_card_order must be a JSON array of card keys")
        if (
            not isinstance(order, list)
            or not all(isinstance(k, str) for k in order)
            or not set(order) <= _VALID_HOME_CARD_KEYS
            or len(order) != len(set(order))
        ):
            raise HTTPException(
                status_code=400,
                detail=f"home_card_order must be a JSON array of unique keys from {sorted(_VALID_HOME_CARD_KEYS)}",
            )

    async with pool.acquire() as conn:
        return await preferences_queries.update_preferences(conn, payload["owner_id"], patch)


class SundayModeBody(BaseModel):
    preset: str


@router.post("/preferences/sunday-mode")
async def apply_sunday_mode(body: SundayModeBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    if body.preset not in preferences_queries.SUNDAY_MODE_PRESETS:
        raise HTTPException(
            status_code=400, detail=f"preset must be one of {sorted(preferences_queries.SUNDAY_MODE_PRESETS)}"
        )
    async with pool.acquire() as conn:
        return await preferences_queries.apply_sunday_mode(conn, payload["owner_id"], body.preset)
