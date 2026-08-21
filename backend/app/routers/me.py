"""
Session-aware "my stuff" endpoints — the homepage hero
(app/domain/your_week.py) and My Team (roster + real ESPN projections,
plus lineup-change PREVIEWS only — see module note on /team/lineup/*
below). Same cookie-decode pattern as /auth/me (app/routers/auth.py);
kept separate since this is homepage/dashboard data, not identity itself.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain.your_week import build_your_week
from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.slots import slot_label
from app.queries import league as league_queries
from app.routers.lineup_shared import map_lineup_error, roster_entry_dict

router = APIRouter(prefix="/me", tags=["me"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


async def _require_my_espn_team_id(owner_id: int, active_season: int) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        team = await league_queries.get_team_for_owner(conn, active_season, owner_id)
    if team is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return team["espn_team_id"], team["team_name"]


@router.get("/week")
async def week(request: Request):
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await build_your_week(conn, payload["owner_id"], active_season)

    if result is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return result


@router.get("/team")
async def my_team(request: Request):
    """LIVE from ESPN, not our DB — same reason as /admin/lineup/teams/{id}/roster
    (app/routers/admin_lineup.py's module docstring): our `rosters` table
    can be genuinely empty (pre-draft) or stale (only synced while a real
    game is live), but ESPN's own live roster is always current."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id, team_name = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        roster = client.get_roster(espn_team_id, active_season)
    except Exception as e:
        raise map_lineup_error(e) from e

    return {
        "team_name": team_name,
        "season": active_season,
        "roster": [roster_entry_dict(e) for e in roster],
    }


class LineupMovePreviewRequest(BaseModel):
    player_name: str
    to_slot: str


class LineupSwapPreviewRequest(BaseModel):
    player_a: str
    player_b: str


@router.post("/team/lineup/preview-move")
async def preview_lineup_move(body: LineupMovePreviewRequest, request: Request):
    """PREVIEW ONLY — validates the move against ESPN's live roster and
    slot rules and describes exactly what would happen, but never
    submits anything to ESPN. This calls ESPNLineupClient.plan_lineup_change
    directly (not set_lineup), which is pure validation with no dry-run/
    real-write machinery involved at all — the deliberate choice made
    with the project owner when this feature was scoped (real ESPN
    lineup submission has never been turned on anywhere in this project;
    see ESPN_LINEUP_WRITE.md)."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id, _ = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        plan = client.plan_lineup_change(espn_team_id, body.player_name, body.to_slot, active_season)
    except Exception as e:
        raise map_lineup_error(e) from e

    return {
        "player": roster_entry_dict(plan.player),
        "from_slot": {"id": plan.from_slot_id, "label": slot_label(plan.from_slot_id)},
        "to_slot": {"id": plan.to_slot_id, "label": slot_label(plan.to_slot_id)},
        "displaced_player": roster_entry_dict(plan.displaced_player) if plan.displaced_player else None,
    }


@router.post("/team/lineup/preview-swap")
async def preview_lineup_swap(body: LineupSwapPreviewRequest, request: Request):
    """PREVIEW ONLY — see preview_lineup_move's docstring."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id, _ = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        plan = client.plan_swap(espn_team_id, body.player_a, body.player_b, active_season)
    except Exception as e:
        raise map_lineup_error(e) from e

    return {
        "player_a": roster_entry_dict(plan.player_a),
        "player_b": roster_entry_dict(plan.player_b),
    }
