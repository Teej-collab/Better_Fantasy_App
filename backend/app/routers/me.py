"""
Session-aware "my stuff" endpoints — the homepage hero
(app/domain/your_week.py) and My Team (roster + real ESPN projections,
lineup-change previews, and real lineup SUBMISSION — see module note on
/team/lineup/* below). Same cookie-decode pattern as /auth/me
(app/routers/auth.py); kept separate since this is homepage/dashboard
data, not identity itself.

/team/lineup/move and /team/lineup/swap are real writes (ESPNLineupClient
.set_lineup()/.swap_players()), gated by ESPN_DRY_RUN like every other
caller of those methods — always scoped to the signed-in owner's own
espn_team_id, resolved server-side from the session, never accepted from
the request body (same discipline as _require_my_espn_team_id everywhere
else in this file). Mirrors admin_lineup.py's set/swap endpoints, minus
team_id (implicit: always "me") and minus as_league_manager (never
applicable to an owner submitting their own lineup).

CROSS-OWNER CREDENTIAL CAVEAT (see ESPN_LINEUP_WRITE.md's "Open question:
does one member's credentials cover other teams?"): every write this app
sends authenticates with a single ESPN session (ESPN_S2/SWID in the
environment — the commissioner's own login), regardless of which owner
is signed in when they hit Submit. Whether ESPN actually allows those
credentials to write a DIFFERENT owner's roster is genuinely unverified.
Per the project owner's explicit call (Aug 2026), this ships to everyone
anyway rather than waiting on that answer — but a write that ESPN
rejects for exactly this reason (an auth-flavored HTTP error, or a
200-looking response that a follow-up roster read shows never actually
applied) is caught by _submit_lineup_fallback_response below and turned
into a plain "couldn't submit, use the ESPN app for now" message instead
of a raw error, and logged distinctly so real traffic can reveal which
owners it actually works for.
"""
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain.your_week import build_your_week
from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.lineup_exceptions import (
    ESPNWriteHTTPError,
    MutationVerificationFailedError,
    RosterFullError,
)
from app.providers.espn.slots import slot_label
from app.queries import league as league_queries
from app.routers.lineup_shared import map_lineup_error, roster_entry_dict

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/me", tags=["me"])


def _submit_lineup_fallback_response(e: Exception, owner_id: int, espn_team_id: int) -> JSONResponse | None:
    """Returns a friendly fallback response for the two failure shapes a
    cross-owner credential rejection would plausibly take, or None if
    this isn't one of those (caller falls back to map_lineup_error).
    See module docstring's CROSS-OWNER CREDENTIAL CAVEAT."""
    if isinstance(e, ESPNWriteHTTPError) and e.status_code in (401, 403):
        logger.warning(
            "ESPN lineup write rejected (auth) for owner_id=%s espn_team_id=%s status=%s — "
            "likely the cross-owner credential limitation, see ESPN_LINEUP_WRITE.md",
            owner_id, espn_team_id, e.status_code,
        )
        return JSONResponse(
            status_code=403,
            content={
                "error": "not_authorized_for_this_team",
                "detail": "Couldn't submit this change through the app right now — please make it directly in the ESPN app for now.",
            },
        )
    if isinstance(e, MutationVerificationFailedError):
        logger.warning(
            "ESPN lineup write not verified after send for owner_id=%s espn_team_id=%s — "
            "possible silent no-op, see ESPN_LINEUP_WRITE.md",
            owner_id, espn_team_id,
        )
        return JSONResponse(
            status_code=409,
            content={
                "error": "not_verified",
                "detail": "ESPN accepted the request but the change didn't apply — please make it directly in the ESPN app for now.",
            },
        )
    return None


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


class LineupMoveRequest(BaseModel):
    player_name: str
    to_slot: str


class LineupSwapRequest(BaseModel):
    player_a: str
    player_b: str


@router.post("/team/lineup/move")
async def submit_lineup_move(body: LineupMoveRequest, request: Request):
    """Real write — see module docstring. Always the caller's own team."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id, _ = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        result = client.set_lineup(espn_team_id, body.player_name, body.to_slot, active_season)
    except Exception as e:
        fallback = _submit_lineup_fallback_response(e, payload["owner_id"], espn_team_id)
        if fallback is not None:
            return fallback
        raise map_lineup_error(e) from e
    return {
        "attempted": result.attempted,
        "dry_run": result.dry_run,
        "verified": result.verified,
        "detail": result.detail,
    }


@router.post("/team/lineup/swap")
async def submit_lineup_swap(body: LineupSwapRequest, request: Request):
    """Real write — see module docstring. Always the caller's own team."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id, _ = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        result = client.swap_players(espn_team_id, body.player_a, body.player_b, active_season)
    except Exception as e:
        fallback = _submit_lineup_fallback_response(e, payload["owner_id"], espn_team_id)
        if fallback is not None:
            return fallback
        raise map_lineup_error(e) from e
    return {
        "attempted": result.attempted,
        "dry_run": result.dry_run,
        "verified": result.verified,
        "detail": result.detail,
    }


class AddFreeAgentPreviewRequest(BaseModel):
    player_id: int
    player_name: str
    position: str
    pro_team: str
    # Only required once a first preview call comes back roster_full —
    # the frontend then re-calls with this set once the visitor picks
    # who to drop.
    drop_player_name: str | None = None


@router.post("/team/free-agents/preview-add")
async def preview_add_free_agent(body: AddFreeAgentPreviewRequest, request: Request):
    """PREVIEW ONLY — see preview_lineup_move's docstring above; same
    deliberate scoping decision, just for a different (and never
    investigated) ESPN write — see app/providers/espn/free_agents.py's
    module note and ESPN_LINEUP_WRITE.md. This only validates against
    the live roster (does the added player already exist there? is
    there an open bench spot, or does something need to be dropped?)
    and reports exactly what adding this player would do — nothing is
    ever sent to ESPN.

    RosterFullError gets its own response shape (not the generic
    map_lineup_error 409) — "needs a drop" is a real decision for the
    frontend to act on, not just an error to display, and a bare 409
    status code can't tell that apart from an unrelated conflict."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    espn_team_id, _ = await _require_my_espn_team_id(payload["owner_id"], active_season)

    client = ESPNLineupClient()
    try:
        plan = client.plan_add_player(
            espn_team_id,
            body.player_id,
            body.player_name,
            body.position,
            body.pro_team,
            body.drop_player_name,
            active_season,
        )
    except RosterFullError as e:
        return JSONResponse(
            status_code=409,
            content={
                "error": "roster_full",
                "detail": str(e),
            },
        )
    except Exception as e:
        raise map_lineup_error(e) from e

    return {
        "added_player": {
            "player_id": plan.added_player_id,
            "player_name": plan.added_player_name,
            "position": plan.added_position,
            "pro_team": plan.added_pro_team,
        },
        "roster_size_before": plan.roster_size_before,
        "roster_capacity": plan.roster_capacity,
        "dropped_player": roster_entry_dict(plan.dropped_player) if plan.dropped_player else None,
    }
