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
from app.auth.league_context import require_commissioner_of, resolve_owner_id
from app.auth.session import create_session_token, decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.queries import auth as auth_queries
from app.queries import chat as chat_queries
from app.queries import leagues as league_queries
from app.queries import teams as team_queries

router = APIRouter(prefix="/leagues", tags=["leagues"])

_LEAGUE_NAME_MAX_LENGTH = 40


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
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

        # Give the new league somewhere to talk from day one — same
        # precedent as seed_default_scoring_rules above ("give a new
        # league a working default"), not something the commissioner
        # has to set up. The creator has no `owners` row yet at this
        # point (that's only created on first team/history-claim), so
        # resolve/create one the same way POST /teams below does.
        user_row = await conn.fetchrow("SELECT display_name FROM users WHERE id = $1", payload["user_id"])
        display_name = (user_row["display_name"] if user_row else None) or "New Owner"
        owner_id = await team_queries.get_or_create_owner_for_user(conn, payload["user_id"], display_name)
        await chat_queries.create_conversation_for_league(conn, league_id, "league", [owner_id])
        await chat_queries.create_conversation_for_league(conn, league_id, "commish_corner", [owner_id])

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
        await chat_queries.add_owner_to_league_conversations(conn, league_id, owner_id)

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
    once linked, an owner can never be claimed again.

    Reissues the session token with the newly-linked owner_id baked in
    (2026-09 fix) — every owner-scoped route (My Team, Keepers, etc.)
    reads owner_id straight off the JWT (app/auth/session.py), which is
    set once at login and never re-derived from the DB. Before this
    fix, claiming here updated owners.user_id correctly but the
    caller's existing session token still carried whatever owner_id
    (typically null) it was minted with at login — so a Google/email
    signup who claimed their historical team immediately hit "No team
    found for this owner" everywhere, since nothing had actually told
    their browser about the new owner_id. The frontend swaps its
    first-party cookie for this new token the same way the OAuth
    callback flow does (see auth/complete/set-cookie's own docstring)."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        membership = await league_queries.get_membership(conn, league_id, payload["user_id"])
        if membership is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        claimed = await league_queries.claim_owner(conn, league_id, body.owner_id, payload["user_id"])
        if not claimed:
            raise HTTPException(
                status_code=409,
                detail="That owner is already claimed, isn't in this league, "
                "or your account already has a different owner linked to it",
            )
        # This is the real, common path for an existing historical
        # owner (pre-dating real accounts) rejoining chat — unlike the
        # team-creation hooks above, a claimed owner already has a real
        # team/history and would otherwise never trigger either of them.
        await chat_queries.add_owner_to_league_conversations(conn, league_id, body.owner_id)
        token_version = await auth_queries.get_token_version(conn, payload["user_id"])

    config = SessionConfig()
    token = create_session_token(
        config.session_secret,
        user_id=payload["user_id"],
        owner_id=body.owner_id,
        discord_user_id=payload.get("discord_user_id"),
        is_commissioner=payload.get("is_commissioner", False),
        token_version=token_version,
    )
    return {"owner_id": body.owner_id, "claimed": True, "token": token}


@router.post("/{league_id}/teams/{team_id}/co-owner-invite")
async def create_co_owner_invite(league_id: int, team_id: int, request: Request):
    """Lets a team's owner (or an existing co-owner — resolve_owner_id
    already resolves either of them to the exact same owner_id, since
    sharing that one identity is the whole point) generate a single-
    use link a friend can redeem to become a co-owner: both people
    then act as this exact owner_id everywhere (chat, trades, lineup,
    push — all already owner_id-keyed, unchanged by this feature).
    `team_id`/`league_id` only confirm the caller actually owns this
    team before handing out a link — the invite itself, once redeemed,
    shares the whole owner identity (every league/team it has), not
    just this one team, since there's no smaller unit to share (see
    app/queries/leagues.py's create_co_owner_invite)."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        if owner_id is None:
            raise HTTPException(status_code=403, detail="You don't have a team to invite a co-owner to")
        owns_team = await conn.fetchval(
            "SELECT 1 FROM teams_by_season WHERE id = $1 AND league_id = $2 AND owner_id = $3",
            team_id, league_id, owner_id,
        )
        if not owns_team:
            raise HTTPException(status_code=403, detail="That's not your team")
        invite_code = await league_queries.create_co_owner_invite(conn, owner_id, payload["user_id"])
    return {"invite_code": invite_code}


class RedeemCoOwnerInviteRequest(BaseModel):
    invite_code: str


@router.post("/co-owner-invites/redeem")
async def redeem_co_owner_invite(body: RedeemCoOwnerInviteRequest, request: Request):
    """Redeeming links the caller to the invite's owner_id and enrolls
    them in every league that owner already has a team in (see
    app/queries/leagues.py's redeem_co_owner_invite) — no prior
    /leagues/join needed, unlike claim-owner above, since a targeted
    co-owner invite has no reason to force that separate manual step.
    Not league-scoped in the URL (unlike claim-owner) since the
    redeemer isn't a member of anything yet at the point they call
    this. Reissues the session token with the shared owner_id baked
    in, same as claim-owner, so the very next request already carries
    it."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await league_queries.redeem_co_owner_invite(conn, body.invite_code, payload["user_id"])
        if result is None:
            raise HTTPException(
                status_code=409,
                detail="That invite has already been used, doesn't exist, or your account "
                "already has a different owner linked to it",
            )
        owner_id, league_ids = result
        for league_id in league_ids:
            await chat_queries.add_owner_to_league_conversations(conn, league_id, owner_id)
        token_version = await auth_queries.get_token_version(conn, payload["user_id"])

    config = SessionConfig()
    token = create_session_token(
        config.session_secret,
        user_id=payload["user_id"],
        owner_id=owner_id,
        discord_user_id=payload.get("discord_user_id"),
        is_commissioner=payload.get("is_commissioner", False),
        token_version=token_version,
    )
    return {"owner_id": owner_id, "token": token}


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
        await chat_queries.add_owner_to_league_conversations(conn, league_id, owner_id)

        existing_team = await team_queries.get_team_for_owner_in_league(conn, league_id, season, owner_id)
        if existing_team is not None:
            raise HTTPException(status_code=409, detail="That member already has a team in this league")

        team = await team_queries.create_team(conn, league_id, season, owner_id, team_name)
    return team
