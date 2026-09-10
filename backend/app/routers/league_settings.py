"""Scoring rules for the caller's own active league — read access is
open to any member (matches keepers.py's own /me read precedent), the
write is commissioner-only. Mirrors keepers.py's shape exactly:
league_id is always resolved from the session's active league, never
accepted from the request itself.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain.schedule import generate_regular_season_schedule
from app.domain.schedule_exceptions import ScheduleError
from app.queries import league as league_read_queries
from app.queries import leagues as league_queries

router = APIRouter(prefix="/league", tags=["league-settings"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


@router.get("/scoring-rules")
async def get_scoring_rules(request: Request, season: int | None = None, pool=Depends(get_pool)):
    payload = _require_session(request)
    # Defaults to the active season (existing behavior, e.g. the
    # Commissioner editor) — an explicit ?season= lets a caller resolve
    # the real rates for a *past* season's matchup (a per-player score
    # breakdown on an old week needs that season's own rules, which can
    # differ after a mid-season change — see upsert_scoring_rules).
    resolved_season = season if season is not None else int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rows = await league_queries.get_scoring_rules(conn, league_id, resolved_season)
    return {"season": resolved_season, "rules": [dict(r) for r in rows]}


class ScoringRulesRequest(BaseModel):
    season: int
    rules: dict[str, float]


@router.put("/scoring-rules")
async def update_scoring_rules(body: ScoringRulesRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await league_queries.upsert_scoring_rules(conn, league_id, body.season, body.rules)
        rows = await league_queries.get_scoring_rules(conn, league_id, body.season)
    return {"season": body.season, "rules": [dict(r) for r in rows]}


@router.get("/playoff-settings")
async def get_playoff_settings(request: Request, pool=Depends(get_pool)):
    """Read access open to any member, same as GET /scoring-rules —
    the commissioner-only edit form uses this to pre-fill, but the
    setting itself (via queries/league.py's get_playoff_settings)
    already powers the public standings page's playoff-line divider,
    and now app/domain/playoffs.py's bracket generator."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        settings = await league_read_queries.get_playoff_settings(conn, season, league_id)
    return {"season": season, **settings}


class PlayoffSettingsRequest(BaseModel):
    season: int
    playoff_team_count: int
    # This league's real ESPN settings (the commissioner's own
    # screenshot): weeks_per_matchup=2. Defaults preserve the prior
    # single-field form's behavior for anyone not yet sending them.
    weeks_per_matchup: int = 1
    start_week: int | None = None


@router.put("/playoff-settings")
async def update_playoff_settings(body: PlayoffSettingsRequest, request: Request, pool=Depends(get_pool)):
    if body.playoff_team_count <= 0:
        raise HTTPException(status_code=400, detail="playoff_team_count must be positive")
    if body.weeks_per_matchup <= 0:
        raise HTTPException(status_code=400, detail="weeks_per_matchup must be positive")
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await league_queries.set_playoff_team_count(
            conn, league_id, body.season, body.playoff_team_count, body.weeks_per_matchup, body.start_week,
        )
    return {
        "season": body.season,
        "playoff_team_count": body.playoff_team_count,
        "weeks_per_matchup": body.weeks_per_matchup,
        "start_week": body.start_week,
    }


class GenerateScheduleRequest(BaseModel):
    season: int
    weeks: int


@router.post("/schedule/generate")
async def generate_schedule(body: GenerateScheduleRequest, request: Request, pool=Depends(get_pool)):
    """Real write — generates this season's real regular-season matchup
    schedule in-app (app/domain/schedule.py), no ESPN read involved.
    Only ever makes sense for a season that hasn't been scheduled yet
    (typically right after teams exist, e.g. right after the draft) —
    refuses with 409 if regular-season matchups already exist for this
    season, rather than silently overwriting a real, possibly-already-
    played schedule."""
    if body.weeks <= 0:
        raise HTTPException(status_code=400, detail="weeks must be positive")
    payload = _require_session(request)
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            created = await generate_regular_season_schedule(conn, body.season, league_id, body.weeks)
    except ScheduleError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"season": body.season, "weeks": body.weeks, "matchups": created}
