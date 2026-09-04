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
from app.auth.league_context import require_commissioner_of
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.queries import auth as auth_queries
from app.queries import leagues as league_queries
from app.queries import teams as team_queries

router = APIRouter(prefix="/leagues", tags=["leagues"])

_LEAGUE_NAME_MAX_LENGTH = 40


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
        active_league_id = await league_queries.get_active_league_id(conn, payload["user_id"])
    return {"leagues": [_league_dict(r, r["role"]) for r in rows], "active_league_id": active_league_id}


@router.post("/{league_id}/select")
async def select_league(league_id: int, request: Request):
    """The ONLY way active_league_id changes (see app/auth/
    league_context.py's module docstring) — verifies real membership
    first, so this can never be used to activate a league the caller
    doesn't actually belong to."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        await league_queries.set_active_league_id(conn, payload["user_id"], league_id)
    return {"active_league_id": league_id}


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


@router.get("/{league_id}/unclaimed-owners")
async def unclaimed_owners(league_id: int, request: Request):
    """Powers the "is one of these you?" picker (see TODO.md's PHASE 9
    entry) — any member of the league can see who's still unclaimed,
    not just the commissioner, since claiming is self-service."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        rows = await league_queries.list_unclaimed_owners(conn, league_id)
    return {"owners": [dict(r) for r in rows]}


class ClaimOwnerRequest(BaseModel):
    owner_id: int


@router.post("/{league_id}/claim-owner")
async def claim_owner(league_id: int, body: ClaimOwnerRequest, request: Request):
    """Self-service history claiming — any League #1 owner can sign up
    by email and claim their own existing chug debts/keeper picks/past
    seasons themselves (see TODO.md's PHASE 9 entry). First-claim-wins:
    once linked, an owner can never be claimed again."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        claimed = await league_queries.claim_owner(conn, league_id, body.owner_id, payload["user_id"])
        if not claimed:
            raise HTTPException(
                status_code=409, detail="That owner is already claimed, or isn't in this league"
            )
    return {"owner_id": body.owner_id, "claimed": True}


@router.get("/{league_id}/members")
async def list_members(league_id: int, request: Request):
    """Who's actually in this league and what role they hold — any
    member can see the roster (same self-service precedent as
    /unclaimed-owners above), not just the commissioner."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        rows = await league_queries.list_members(conn, league_id)
    return {"members": [dict(r) for r in rows]}


class SetMemberRoleRequest(BaseModel):
    role: str


class RenameLeagueRequest(BaseModel):
    name: str


@router.patch("/{league_id}")
async def rename_league(league_id: int, body: RenameLeagueRequest, request: Request):
    """Commissioner-only rename — this name is what shows up on that
    league's own ticker/label wherever the app distinguishes it from
    other leagues (see the homepage's league ticker)."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a league name")
    if len(name) > _LEAGUE_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"League name must be {_LEAGUE_NAME_MAX_LENGTH} characters or fewer")
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        await league_queries.rename_league(conn, league_id, name)
        row = await league_queries.get_league(conn, league_id)
    return _league_dict(row)


@router.patch("/{league_id}/members/{user_id}")
async def set_member_role(league_id: int, user_id: int, body: SetMemberRoleRequest, request: Request):
    """Promote/demote another member — commissioner-only (a member
    could otherwise hand themselves commissioner). Deliberately can
    never target the caller's own row: there's no path through this
    endpoint, even a mistaken click, that removes a commissioner's own
    access — the only way to lose it is another commissioner doing it
    to you."""
    if body.role not in ("commissioner", "member"):
        raise HTTPException(status_code=400, detail="role must be 'commissioner' or 'member'")
    payload = _require_session(request)
    if user_id == payload["user_id"]:
        raise HTTPException(status_code=400, detail="Use another commissioner's account to change your own role")
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        changed = await league_queries.set_member_role(conn, league_id, user_id, body.role)
        if not changed:
            raise HTTPException(status_code=404, detail="That user isn't a member of this league")
    return {"user_id": user_id, "role": body.role}


@router.delete("/{league_id}/members/{user_id}")
async def remove_member(league_id: int, user_id: int, request: Request):
    """Revokes a member's access to this league — commissioner-only.
    Never touches their owners record, history, or any team they
    currently have (see queries/leagues.py's remove_member docstring);
    use the reassign-team endpoint below separately if a vacated team
    should go to someone else. Can't target the caller's own row (same
    self-protection as set_member_role above) — since the caller must
    already be a commissioner to reach this point, and can never target
    themselves, the league always has at least the caller left as a
    commissioner afterward. No separate "don't remove the only
    commissioner" guard is needed on top of that: the only way this
    endpoint could ever be called with the target being the league's
    sole commissioner is the caller targeting themselves, which is
    already blocked above."""
    payload = _require_session(request)
    if user_id == payload["user_id"]:
        raise HTTPException(status_code=400, detail="Use another commissioner's account to remove your own access")
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        removed = await league_queries.remove_member(conn, league_id, user_id)
        if not removed:
            raise HTTPException(status_code=404, detail="That user isn't a member of this league")
    return {"user_id": user_id, "removed": True}


class ReassignTeamRequest(BaseModel):
    user_id: int


@router.post("/{league_id}/teams/{team_id}/reassign")
async def reassign_team(league_id: int, team_id: int, body: ReassignTeamRequest, request: Request):
    """Hands an existing team's roster and history to a different
    current league member — commissioner-only. The target must already
    be a member of this league (join first via invite code, then
    reassign) — this never invites someone new on its own."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        membership = await league_queries.get_membership(conn, league_id, body.user_id)
        if membership is None:
            raise HTTPException(status_code=400, detail="That user isn't a member of this league")
        user_row = await conn.fetchrow("SELECT display_name FROM users WHERE id = $1", body.user_id)
        display_name = (user_row["display_name"] if user_row else None) or "New Owner"
        team = await team_queries.reassign_team(conn, league_id, season, team_id, body.user_id, display_name)
        if team is None:
            raise HTTPException(status_code=404, detail="No team found for this league/season")
    return team


class CreateTeamForMemberRequest(BaseModel):
    user_id: int
    team_name: str


@router.post("/{league_id}/teams/for-member")
async def create_team_for_member(league_id: int, body: CreateTeamForMemberRequest, request: Request):
    """Commissioner-invoked counterpart to the self-serve POST /{league_id}
    /teams above — for a new team mid-season (e.g. a member who joined
    after the league started and hasn't self-served their own team yet),
    not for handing off an EXISTING team (that's reassign_team above).
    Same one-team-per-owner-per-season guard as the self-serve version;
    the target must already be a real member of this league."""
    payload = _require_session(request)
    team_name = body.team_name.strip()
    if not team_name:
        raise HTTPException(status_code=400, detail="Enter a team name")

    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        membership = await league_queries.get_membership(conn, league_id, body.user_id)
        if membership is None:
            raise HTTPException(status_code=400, detail="That user isn't a member of this league")

        user_row = await conn.fetchrow("SELECT display_name FROM users WHERE id = $1", body.user_id)
        display_name = (user_row["display_name"] if user_row else None) or "New Owner"
        owner_id = await team_queries.get_or_create_owner_for_user(conn, body.user_id, display_name)

        existing_team = await team_queries.get_team_for_owner_in_league(conn, league_id, season, owner_id)
        if existing_team is not None:
            raise HTTPException(status_code=409, detail="That member already has a team in this league")

        team = await team_queries.create_team(conn, league_id, season, owner_id, team_name)
    return team
