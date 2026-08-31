"""Create/join/list leagues, and create a team within one — the
self-serve flow that turns "The Weekend" from one closed league into a
real multi-league product (Phase 5 follow-on of the multi-league
migration, see TODO.md's PHASE 9 entry).

Deliberately does NOT touch ESPN sync, drafts, or scoring — a new
league starts empty (no teams) until its members create teams here;
draft setup (POST /draft/setup) and scoring already work per-league as
of Phase 4, so nothing else needs to change for a self-serve league to
become fully playable once it has teams.
"""
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.queries import auth as auth_queries
from app.queries import leagues as league_queries
from app.queries import teams as team_queries

router = APIRouter(prefix="/leagues", tags=["leagues"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def _league_dict(row, role: str | None = None) -> dict:
    d = {"id": row["id"], "name": row["name"], "invite_code": row["invite_code"], "created_at": row["created_at"]}
    if role is not None:
        d["role"] = role
    return d


@router.get("/mine")
async def my_leagues(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await league_queries.list_leagues_for_user(conn, payload["user_id"])
    return {"leagues": [_league_dict(r, r["role"]) for r in rows]}


class CreateLeagueRequest(BaseModel):
    name: str


@router.post("")
async def create_league(body: CreateLeagueRequest, request: Request):
    payload = _require_session(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a league name")

    invite_code = secrets.token_urlsafe(8)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await league_queries.create_league(conn, name, payload["user_id"], invite_code)
        await league_queries.add_member(conn, league_id, payload["user_id"], "commissioner")
        await league_queries.seed_default_scoring_rules(conn, league_id, season)
        row = await league_queries.get_league(conn, league_id)
    return _league_dict(row, "commissioner")


class JoinLeagueRequest(BaseModel):
    invite_code: str


@router.post("/join")
async def join_league(body: JoinLeagueRequest, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        league = await league_queries.get_league_by_invite_code(conn, body.invite_code.strip())
        if league is None:
            raise HTTPException(status_code=404, detail="No league found for that invite code")
        await league_queries.add_member(conn, league["id"], payload["user_id"], "member")
        membership = await league_queries.get_membership(conn, league["id"], payload["user_id"])
    return _league_dict(league, membership["role"])


class CreateTeamRequest(BaseModel):
    team_name: str


@router.post("/{league_id}/teams")
async def create_team(league_id: int, body: CreateTeamRequest, request: Request):
    """A member creates their own team in a league they already belong
    to — the step that actually gives a self-serve league something to
    draft/roster/score. One team per owner per league per season."""
    payload = _require_session(request)
    team_name = body.team_name.strip()
    if not team_name:
        raise HTTPException(status_code=400, detail="Enter a team name")

    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")

        user_row = await conn.fetchrow("SELECT display_name FROM users WHERE id = $1", payload["user_id"])
        display_name = (user_row["display_name"] if user_row else None) or "New Owner"
        owner_id = await team_queries.get_or_create_owner_for_user(conn, payload["user_id"], display_name)

        existing_team = await team_queries.get_team_for_owner_in_league(conn, league_id, season, owner_id)
        if existing_team is not None:
            raise HTTPException(status_code=409, detail="You already have a team in this league")

        team = await team_queries.create_team(conn, league_id, season, owner_id, team_name)
    return team


@router.get("/{league_id}/teams")
async def list_teams(league_id: int, request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        rows = await team_queries.list_teams_for_league(conn, league_id, season)
    return {"teams": [dict(r) for r in rows]}
