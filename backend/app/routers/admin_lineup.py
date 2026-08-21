"""
Admin-gated HTTP surface for app/providers/espn/lineup_client.py.

Nothing calls ESPNLineupClient anywhere else yet except app/routers/me.py's
/me/team routes (session-gated, always the signed-in owner's own team) —
Discord commands were explicitly out of scope for the lineup-write
investigation (see ESPN_LINEUP_WRITE.md), so without this router there
was no way to actually exercise set_lineup()/swap_players() except by
running Python directly. This exists purely so the write feature can be
tested (via curl or Postman) against ANY team_id before any real UI
existed on top of it.

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
from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.providers.espn.lineup_client import ESPNLineupClient
from app.routers.admin import _check_admin_token
from app.routers.lineup_shared import map_lineup_error, roster_entry_dict

router = APIRouter(prefix="/admin/lineup", tags=["admin"])


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
        raise map_lineup_error(e) from e
    return {"team_id": team_id, "roster": [roster_entry_dict(e) for e in roster]}


@router.post("/teams/{team_id}/set")
async def set_lineup(team_id: int, body: SetLineupRequest, x_admin_token: str | None = Header(default=None)):
    _check_admin_token(x_admin_token)
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
async def swap_players(team_id: int, body: SwapRequest, x_admin_token: str | None = Header(default=None)):
    _check_admin_token(x_admin_token)
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
