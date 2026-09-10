"""
Commissioner-gated HTTP surface for app/providers/espn/lineup_client.py.

Nothing calls ESPNLineupClient anywhere else yet except app/routers/me.py's
/me/team routes (session-gated, always the signed-in owner's own team) —
Discord commands were explicitly out of scope for the lineup-write
investigation (see ESPN_LINEUP_WRITE.md), so without this router there
was no way to actually exercise set_lineup()/swap_players() except by
running Python directly. This exists purely so the write feature can be
tested against ANY team_id — a commissioner acting on behalf of the
league, not a self-service owner endpoint (that's /me/team's job).

Deliberately reads LIVE from ESPN via ESPNLineupClient, never from our
own `rosters` table — that table can be genuinely empty pre-draft (the
sync pipeline's "has this week really happened yet" gates mean it saves
nothing for a scoreless preseason week), but ESPN's live team.roster is
available regardless, which is exactly why this feature never needed our
DB in the first place. Same is_commissioner session gate as admin.py —
this used to run on the old X-Admin-Token stopgap before Phase 5's real
auth existed; migrated once Phase 5 was confirmed working (Aug 19, 2026).

Gated on League #1's commissioner specifically, not "whichever league
the caller currently has active" — this whole router only ever talks to
the one real ESPN-connected league (same reasoning as app/routers/
admin.py — see TODO.md's PHASE 9 entry, Phase 6, not built yet).

Safe by default: ESPN_DRY_RUN defaults to true, so hitting the mutation
endpoints here just logs and returns what WOULD be sent until that's
explicitly turned off in .env.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of
from app.auth.session import decode_session_token, get_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.db import get_pool
from app.providers.espn.lineup_client import ESPNLineupClient
from app.routers.lineup_shared import map_lineup_error, roster_entry_dict

router = APIRouter(prefix="/admin/lineup", tags=["admin"])


def _require_session(request: Request) -> dict:
    config = SessionConfig()
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


async def _require_commissioner(request: Request) -> None:
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)


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
async def live_roster(team_id: int, request: Request, season: int | None = None):
    """LIVE from ESPN, not our DB — see module docstring for why."""
    await _require_commissioner(request)
    client = ESPNLineupClient()
    try:
        roster = client.get_roster(team_id, season)
    except Exception as e:
        raise map_lineup_error(e) from e
    return {"team_id": team_id, "roster": [roster_entry_dict(e) for e in roster]}


@router.post("/teams/{team_id}/set")
async def set_lineup(team_id: int, body: SetLineupRequest, request: Request):
    await _require_commissioner(request)
    client = ESPNLineupClient()
    try:
        result = client.set_lineup(
            team_id, body.player_name, body.to_slot, body.season, body.as_league_manager
        )
    except Exception as e:
        raise map_lineup_error(e) from e
    return {
        "attempted": result.attempted,
        "dry_run": result.dry_run,
        "verified": result.verified,
        "detail": result.detail,
    }


@router.post("/teams/{team_id}/swap")
async def swap_players(team_id: int, body: SwapRequest, request: Request):
    await _require_commissioner(request)
    client = ESPNLineupClient()
    try:
        result = client.swap_players(
            team_id, body.player_a, body.player_b, body.season, body.as_league_manager
        )
    except Exception as e:
        raise map_lineup_error(e) from e
    return {
        "attempted": result.attempted,
        "dry_run": result.dry_run,
        "verified": result.verified,
        "detail": result.detail,
    }
