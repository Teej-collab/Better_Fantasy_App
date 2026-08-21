"""Shared between app/routers/admin_lineup.py (admin-token-gated, any
team_id) and app/routers/me.py's /me/team routes (session-gated, always
the signed-in owner's own team) — same ESPNLineupClient underneath, same
error mapping and roster serialization, just different auth and target
team resolution."""
from datetime import datetime, timezone

from fastapi import HTTPException

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


def is_locked(game_start) -> bool:
    if game_start is None:
        return False
    if game_start.tzinfo is None:
        game_start = game_start.replace(tzinfo=timezone.utc)
    return game_start <= datetime.now(timezone.utc)


def roster_entry_dict(entry) -> dict:
    return {
        "player_id": entry.player_id,
        "player_name": entry.player_name,
        "lineup_slot_id": entry.lineup_slot_id,
        "lineup_slot_label": entry.lineup_slot_label,
        "eligible_slots": [{"id": sid, "label": slot_label(sid)} for sid in entry.eligible_slot_ids],
        "pro_team": entry.pro_team,
        "injury_status": entry.injury_status,
        "game_start": entry.game_start.isoformat() if entry.game_start else None,
        "is_locked": is_locked(entry.game_start),
        "points_scored": entry.points_scored,
        "points_projected": entry.points_projected,
    }


def map_lineup_error(e: Exception) -> HTTPException:
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
