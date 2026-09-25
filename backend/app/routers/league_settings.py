"""Scoring rules for the caller's own active league — read access is
open to any member (matches keepers.py's own /me read precedent), the
write is commissioner-only. Mirrors keepers.py's shape exactly:
league_id is always resolved from the session's active league, never
accepted from the request itself.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain.schedule import generate_regular_season_schedule
from app.domain.schedule_exceptions import ScheduleError
from app.encryption import decrypt_secret, encrypt_secret
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig
from app.providers.sync import run_full_sync
from app.queries import league as league_read_queries
from app.queries import league_espn_connections as espn_connection_queries
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


# --- ESPN connection (Phase 6 of the multi-league migration — see
# TODO.md's PHASE 9 entry). Lets a league other than League #1 import
# its own real ESPN league, instead of ESPN_LEAGUE_ID/ESPN_S2/
# ESPN_SWID only ever describing one global league. This on-demand
# manual sync is deliberately still here even though app/scheduler.py's
# full/live sync jobs now also iterate every connected league
# automatically (same day, same phase) — a commissioner who just
# connected wants to see real data immediately, not wait for the next
# scheduled tick (schedulers are off by default in dev anyway — see
# AGENTS.md). Week settlement and weekly compute needed no scheduler
# changes at all — both were already fully multi-league (DB-only
# compute, no ESPN calls, already looping every league with real teams
# for the season).


class ConnectEspnRequest(BaseModel):
    espn_league_id: int
    espn_s2: str
    espn_swid: str


@router.get("/espn-connection")
async def get_espn_connection(request: Request, pool=Depends(get_pool)):
    """Read access open to any member, same precedent as scoring-rules/
    playoff-settings above. Never returns the decrypted credentials —
    write-only past the moment they're saved — just enough for the
    commissioner-only UI to show connection status."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        row = await espn_connection_queries.get_connection(conn, league_id)
    if row is None:
        return {"connected": False}
    return {
        "connected": True,
        "espn_league_id": row["espn_league_id"],
        "last_synced_at": row["last_synced_at"],
        "last_sync_error": row["last_sync_error"],
    }


@router.post("/espn-connection")
async def connect_espn(body: ConnectEspnRequest, request: Request, pool=Depends(get_pool)):
    """Validates the given credentials against a real ESPN fetch BEFORE
    saving anything (ESPNProvider.get_current_week, the cheapest real
    call that still exercises the same League(...) construction every
    sync step depends on) — a bad League ID/S2/SWID fails loud here, at
    connect time, rather than silently at the next sync. Encrypts
    espn_s2/swid at rest (app/encryption.py) — the first real per-user
    credential this app stores in its own database rather than only
    ever reading from an env var."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))

    espn_config = ESPNConfig(
        league_id=body.espn_league_id, espn_s2=body.espn_s2, swid=body.espn_swid, active_season=season,
    )
    try:
        await ESPNProvider(espn_config).get_current_week(season)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail="Couldn't connect to that ESPN league — check the League ID, ESPN_S2, and SWID values.",
        ) from e

    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        row = await espn_connection_queries.upsert_connection(
            conn, league_id, body.espn_league_id,
            encrypt_secret(body.espn_s2), encrypt_secret(body.espn_swid),
            payload["user_id"],
        )
    return {"connected": True, "espn_league_id": row["espn_league_id"]}


@router.delete("/espn-connection")
async def disconnect_espn(request: Request, pool=Depends(get_pool)):
    """Removes the connection only — never touches whatever this league
    already synced from it (teams_by_season, matchups, rosters, ...),
    same "disconnecting a source never deletes the data it produced"
    posture as every other integration in this app."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await espn_connection_queries.delete_connection(conn, league_id)
    return Response(status_code=204)


@router.post("/espn-connection/sync")
async def sync_espn_now(request: Request, pool=Depends(get_pool)):
    """Commissioner-triggered, on-demand sync for this league's own
    connected ESPN league — the per-league counterpart to admin.py's
    League #1-only POST /admin/sync. Only ever syncs the active season,
    never a historical backfill range (see ESPNConfig's own docstring)
    — a newly-connected league's most useful first sync is "what does
    my league look like right now," and run_full_sync's per-step
    try/except means a partial failure here still returns whatever DID
    succeed rather than an all-or-nothing 500.

    last_sync_error tracks the "teams" step specifically as this sync's
    overall health signal, not every step — a teams-sync failure means
    the ESPN connection itself is broken (expired S2/SWID, league ID
    changed), the one failure mode a commissioner actually needs to act
    on; a downstream compute step failing on its own real bug is a
    backend concern, not a "reconnect your ESPN league" one."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))

    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        connection = await espn_connection_queries.get_connection(conn, league_id)
    if connection is None:
        raise HTTPException(status_code=409, detail="Connect an ESPN league first")

    try:
        espn_config = ESPNConfig(
            league_id=connection["espn_league_id"],
            espn_s2=decrypt_secret(connection["espn_s2_encrypted"]),
            swid=decrypt_secret(connection["espn_swid_encrypted"]),
            active_season=season,
        )
        results = await run_full_sync(ESPNProvider(espn_config), season, season, league_id=league_id)
    except Exception as e:
        async with pool.acquire() as conn:
            await espn_connection_queries.mark_sync_failure(conn, league_id, str(e))
        raise HTTPException(status_code=502, detail=f"Sync failed: {e}") from e

    teams_result = results.get(season, {}).get("teams", {})
    async with pool.acquire() as conn:
        if teams_result.get("status") == "failed":
            await espn_connection_queries.mark_sync_failure(conn, league_id, teams_result.get("detail", "Sync failed"))
        else:
            await espn_connection_queries.mark_sync_success(conn, league_id)
    return {"season": season, "results": results}
