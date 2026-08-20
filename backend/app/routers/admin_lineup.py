"""
Admin-gated HTTP surface for app/providers/espn/lineup_client.py.

Nothing calls ESPNLineupClient anywhere else yet — Discord commands were
explicitly out of scope for the lineup-write investigation (see
ESPN_LINEUP_WRITE.md), so without this router there was no way to
actually exercise set_lineup()/swap_players() except by running Python
directly. This exists purely so the write feature can be tested (via
curl or Postman) before any real UI — Discord or otherwise — gets built
on top of it.

Deliberately reads LIVE from ESPN via ESPNLineupClient, never from our
own `rosters` table — that table can be genuinely empty pre-draft (the
sync pipeline's "has this week really happened yet" gates mean it saves
nothing for a scoreless preseason week), but ESPN's live team.roster is
available regardless, which is exactly why this feature never needed our
DB in the first place. Same X-Admin-Token stopgap auth as admin.py, for
the same reason: real auth (Phase 5) doesn't cover this yet.

Safe by default: ESPN_DRY_RUN defaults to true, so hitting the mutation
endpoints here just logs and returns what WOULD be sent until that's
explicitly turned off in .env.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.lineup_exceptions import (
    AmbiguousDisplacementError,
    ESPNWriteHTTPError,
    ESPNWriteMalformedResponseError,
    ESPNWriteTimeoutError,
    InvalidSlotError,
    LineupLockedError,
    MutationVerificationFailedError,
    PlayerNotFoundError,
    SlotIneligibleError,
    TeamNotFoundError,
    WriteNotVerifiedError,
)
from app.providers.espn.slots import slot_label
from app.routers.admin import _check_admin_token

router = APIRouter(prefix="/admin/lineup", tags=["admin"])


def _is_locked(game_start) -> bool:
    if game_start is None:
        return False
    if game_start.tzinfo is None:
        game_start = game_start.replace(tzinfo=timezone.utc)
    return game_start <= datetime.now(timezone.utc)


def _roster_entry_dict(entry) -> dict:
    return {
        "player_id": entry.player_id,
        "player_name": entry.player_name,
        "lineup_slot_id": entry.lineup_slot_id,
        "lineup_slot_label": entry.lineup_slot_label,
        "eligible_slots": [{"id": sid, "label": slot_label(sid)} for sid in entry.eligible_slot_ids],
        "pro_team": entry.pro_team,
        "injury_status": entry.injury_status,
        "game_start": entry.game_start.isoformat() if entry.game_start else None,
        "is_locked": _is_locked(entry.game_start),
    }


def _map_lineup_error(e: Exception) -> HTTPException:
    if isinstance(e, (TeamNotFoundError, PlayerNotFoundError)):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, (InvalidSlotError, SlotIneligibleError, AmbiguousDisplacementError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, LineupLockedError):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, WriteNotVerifiedError):
        return HTTPException(status_code=501, detail=str(e))
    if isinstance(e, ESPNWriteTimeoutError):
        return HTTPException(status_code=504, detail=str(e))
    if isinstance(e, MutationVerificationFailedError):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, (ESPNWriteHTTPError, ESPNWriteMalformedResponseError)):
        return HTTPException(status_code=502, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


class SetLineupRequest(BaseModel):
    player_name: str
    to_slot: str
    season: int | None = None
    as_league_manager: bool = False


class SwapRequest(BaseModel):
    player_a: str
    player_b: str
    season: int | None = None
    as_league_manager: bool = False


@router.get("/teams/{team_id}/roster")
async def live_roster(team_id: int, season: int | None = None, x_admin_token: str | None = Header(default=None)):
    """LIVE from ESPN, not our DB — see module docstring for why."""
    _check_admin_token(x_admin_token)
    client = ESPNLineupClient()
    try:
        roster = client.get_roster(team_id, season)
    except Exception as e:
        raise _map_lineup_error(e) from e
    return {"team_id": team_id, "roster": [_roster_entry_dict(e) for e in roster]}


@router.post("/teams/{team_id}/set")
async def set_lineup(team_id: int, body: SetLineupRequest, x_admin_token: str | None = Header(default=None)):
    _check_admin_token(x_admin_token)
    client = ESPNLineupClient()
    try:
        result = client.set_lineup(
            team_id, body.player_name, body.to_slot, body.season, body.as_league_manager
        )
    except Exception as e:
        raise _map_lineup_error(e) from e
    return {
        "attempted": result.attempted,
        "dry_run": result.dry_run,
        "verified": result.verified,
        "detail": result.detail,
    }


@router.post("/teams/{team_id}/swap")
async def swap_players(team_id: int, body: SwapRequest, x_admin_token: str | None = Header(default=None)):
    _check_admin_token(x_admin_token)
    client = ESPNLineupClient()
    try:
        result = client.swap_players(
            team_id, body.player_a, body.player_b, body.season, body.as_league_manager
        )
    except Exception as e:
        raise _map_lineup_error(e) from e
    return {
        "attempted": result.attempted,
        "dry_run": result.dry_run,
        "verified": result.verified,
        "detail": result.detail,
    }
