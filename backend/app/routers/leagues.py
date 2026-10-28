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
import html
import re
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of, resolve_owner_id
from app.auth.session import create_session_token, decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app import monitoring
from app.notifications import admin_alerts
from app.notifications import email as email_notifications
from app.domain import commish_log, league_format, league_import
from app.queries import auth as auth_queries
from app.queries import chat as chat_queries
from app.queries import draft as draft_queries
from app.queries import keepers as keeper_queries
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
    d = {
        "id": row["id"],
        "name": row["name"],
        "invite_code": row["invite_code"],
        "created_at": row["created_at"],
        "team_count": row.get("team_count"),
        "chug_enabled": bool(row.get("chug_enabled")),
        "chug_rule_name": row.get("chug_rule_name"),
        **(league_format.format_from_row(row) if row.get("league_type") else {}),
    }
    if role is not None:
        d["role"] = role
    return d


class CustomLeagueRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.post("/custom-request")
async def request_custom_league(body: CustomLeagueRequest, request: Request):
    """The Create a League flow's "Custom" option (2026-10): someone
    describes the league they want and it reaches the site admin — in
    the feedback inbox, as an admin push, and by email."""
    payload = _require_session(request)
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Tell us about the league you want")
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT display_name, email FROM users WHERE id = $1", payload["user_id"])
        owner_id = await resolve_owner_id(conn, payload)
        owner_name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id) if owner_id else None
        name = owner_name or (user["display_name"] if user else None) or "Someone"
        email = user["email"] if user else None
        await conn.execute(
            "INSERT INTO feedback (user_id, submitted_by, message, page_url) VALUES ($1, $2, $3, $4)",
            payload["user_id"], name, f"[Custom league request] {message}", "/start?create=custom",
        )
        if monitoring.is_test_request(request):
            return {"status": "ok"}
        try:
            await admin_alerts.alert_feedback(conn, name, f"Custom league request: {message}", False, owner_id)
        except Exception:
            pass
    safe = html.escape(message).replace("\n", "<br>")
    await email_notifications.send_admin_alert(
        f"Custom league request from {name}",
        f"<p><b>{html.escape(name)}</b>{f' ({html.escape(email)})' if email else ''} wants a custom league:</p>"
        f"<blockquote>{safe}</blockquote>",
    )
    return {"status": "ok"}


@router.get("/formats")
async def league_formats():
    """Every league format option and whether a new league can pick it
    yet — the Create a League flow shows the rest as "Coming soon"."""
    return {
        field: [{"key": key, "available": key in league_format.AVAILABLE[field]} for key in options]
        for field, options in (
            ("league_type", league_format.LEAGUE_TYPES),
            ("matchup_type", league_format.MATCHUP_TYPES),
            ("draft_type", league_format.DRAFT_TYPES),
            ("roster_preset", league_format.ROSTER_PRESETS),
        )
    } | {"type_settings": {t: {k: {"default": d, "min": lo, "max": hi} for k, (d, lo, hi) in v.items()}
                           for t, v in league_format.TYPE_SETTING_LIMITS.items()}}


@router.get("/mine")
async def my_leagues(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        rows = await league_queries.list_leagues_for_user(conn, payload["user_id"])
        active_league_id = await league_queries.get_active_league_id(conn, payload["user_id"])
        # The league picker's card line for each (your team, record, draft).
        summaries = await league_queries.league_card_summaries(conn, payload["user_id"], season, [r["id"] for r in rows])
    return {
        "leagues": [{**_league_dict(r, r["role"]), "summary": summaries.get(r["id"])} for r in rows],
        "active_league_id": active_league_id,
    }


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
    # The Create a League flow's basics; all optional so older clients
    # (name only) keep working.
    team_count: int | None = Field(default=None, ge=2, le=32)
    scoring: str | None = None  # "ppr" | "half" | "standard"
    keepers: bool | None = None
    # League format (2026-10, app/domain/league_format.py). All
    # optional: an older client gets a standard redraft (or keeper,
    # from `keepers`) head-to-head snake league, exactly as before.
    league_type: str | None = None
    matchup_type: str = "h2h"
    draft_type: str = "snake"
    roster_preset: str = "standard"
    type_settings: dict | None = None
    # The Create a League flow switches you to the new league; the
    # Leagues page's plain create doesn't.
    make_active: bool = False


@router.post("")
async def create_league(body: CreateLeagueRequest, request: Request):
    payload = _require_session(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a league name")
    if body.scoring is not None and body.scoring not in league_queries.SCORING_PRESETS:
        raise HTTPException(status_code=422, detail="Scoring must be PPR, Half PPR or Standard")
    league_type = body.league_type or ("keeper" if body.keepers else "redraft")
    choices = {
        "league_type": league_type,
        "matchup_type": body.matchup_type,
        "draft_type": body.draft_type,
        "roster_preset": body.roster_preset,
    }
    for field, value in choices.items():
        if value not in getattr(league_format, f"{field.upper()}S"):
            raise HTTPException(status_code=422, detail=f"Unknown {field.replace('_', ' ')}: {value}")
    if league_format.unavailable_choice(choices):
        raise HTTPException(status_code=422, detail="That league format isn't available yet")
    type_settings = league_format.normalize_type_settings(league_type, body.draft_type, body.type_settings)

    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        invite_code = await league_queries.new_invite_code(conn)
        league_id = await league_queries.create_league(conn, name, payload["user_id"], invite_code, body.team_count)
        await league_queries.set_league_format(conn, league_id, choices, type_settings)
        await draft_queries.upsert_roster_slots_setting(
            conn, season, league_format.roster_slots_for(body.roster_preset, league_type, type_settings), league_id,
        )
        await league_queries.add_member(conn, league_id, payload["user_id"], "commissioner")
        if body.make_active:
            await league_queries.set_active_league_id(conn, payload["user_id"], league_id)
        await league_queries.seed_default_scoring_rules(conn, league_id, season)
        if body.scoring is not None:
            await league_queries.apply_scoring_preset(conn, league_id, season, body.scoring)
        if league_type == "keeper":
            await keeper_queries.upsert_rules(conn, season, type_settings["keepers_per_team"], None, None, league_id)
        elif body.keepers is not None:
            await keeper_queries.upsert_rules(conn, season, 0, None, None, league_id)

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
    # The Join flow switches you to the league you just joined.
    make_active: bool = False


def _code_from(text: str) -> str:
    """An invite code, whether pasted bare or inside a join link
    (…/leagues?join=CODE or …/join/CODE)."""
    text = text.strip()
    m = re.search(r"[?&]join=([^&#\s]+)", text) or re.search(r"/join/([^/?#\s]+)", text)
    return unquote(m.group(1)) if m else text


@router.get("/preview")
async def preview_league(code: str, request: Request):
    """The league behind an invite code, before joining: its name, how
    full it is, scoring style, seasons of history and commissioner —
    the Join flow's "League found" card. Signed-in only, like joining."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league = await league_queries.get_league_by_invite_code(conn, _code_from(code))
        if league is None:
            raise HTTPException(status_code=404, detail="No league found for that code")
        preview = await league_queries.league_preview(conn, league["id"], season)
        membership = await league_queries.get_membership(conn, league["id"], payload["user_id"])
    return {
        "id": league["id"],
        "name": league["name"],
        "invite_code": league["invite_code"],
        "season": season,
        "team_count": league["team_count"],
        "already_member": membership is not None,
        **preview,
    }


@router.post("/join")
async def join_league(body: JoinLeagueRequest, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        league = await league_queries.get_league_by_invite_code(conn, _code_from(body.invite_code))
        if league is None:
            raise HTTPException(status_code=404, detail="No league found for that invite code")
        await league_queries.add_member(conn, league["id"], payload["user_id"], "member")
        # Already has a team here (their ESPN identity matched when the
        # league was connected): they're in its chats like anyone who
        # claimed theirs, with nothing to pick.
        mine = next(
            (r for r in await league_queries.linked_owners_in_league(conn, league["id"]) if r["user_id"] == payload["user_id"]),
            None,
        )
        if mine:
            await chat_queries.add_owner_to_league_conversations(conn, league["id"], mine["owner_id"])
        if body.make_active:
            await league_queries.set_active_league_id(conn, payload["user_id"], league["id"])
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


class ImportPreviewRequest(BaseModel):
    platform: str
    league: str
    espn_s2: str | None = None
    espn_swid: str | None = None


@router.post("/import-preview")
async def import_preview(body: ImportPreviewRequest, request: Request):
    """The new-commissioner flow's "Found your league" (2026-10-24): an
    ESPN or Sleeper league's name, week and teams, looked up without
    saving anything. Signed-in only."""
    _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    try:
        return await league_import.preview(
            body.platform, body.league, season, (body.espn_s2 or "").strip(), (body.espn_swid or "").strip()
        )
    except league_import.ImportLookupError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/sleeper-leagues")
async def sleeper_leagues(username: str, request: Request):
    """A Sleeper user's leagues this season, looked up by username
    (2026-10-24) — no link to copy. Signed-in only; saves nothing."""
    from app.providers.sleeper.league import SleeperLeagueNotFound, leagues_for_username

    _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    try:
        leagues = await leagues_for_username(username, season)
    except SleeperLeagueNotFound as e:
        raise HTTPException(status_code=404, detail="No Sleeper user by that name. Check the spelling.") from e
    return {"leagues": leagues, "season": season}


class MyTeamRequest(BaseModel):
    team_id: int


@router.post("/{league_id}/my-team")
async def choose_my_team(league_id: int, body: MyTeamRequest, request: Request):
    """One ESPN/Sleeper login runs several teams in this league: the
    caller keeps the one they pick, and each other team gets its own
    unclaimed owner for its real manager to claim (2026-10-28)."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        if await league_queries.get_membership(conn, league_id, payload["user_id"]) is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        freed = await team_queries.split_shared_login(conn, league_id, payload["user_id"], body.team_id)
    if freed is None:
        raise HTTPException(status_code=409, detail="That isn't one of the teams your account runs here.")
    return {"kept_team_id": body.team_id, "freed": freed}


class NotMyTeamRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/{league_id}/not-my-team")
async def report_not_my_team(league_id: int, body: NotMyTeamRequest, request: Request):
    """"Not my team?" on the screen that says which team is yours: it
    changes nothing by itself (a wrong unlink would be worse than a wrong
    match); it lands in Feedback and alerts the admins, who can merge or
    split owners by hand."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        if await league_queries.get_membership(conn, league_id, payload["user_id"]) is None:
            raise HTTPException(status_code=403, detail="You're not a member of this league")
        league = await conn.fetchval("SELECT name FROM leagues WHERE id = $1", league_id)
        who = await conn.fetchval("SELECT COALESCE(display_name, email) FROM users WHERE id = $1", payload["user_id"])
        teams = await team_queries.teams_for_user_in_league(conn, league_id, payload["user_id"])
        owner_id = teams[0]["owner_id"] if teams else None
        message = (
            f"Not my team: {who} says the team the app matched them to in {league} (league {league_id}) "
            f"isn't theirs. Matched: {', '.join(t['team_name'] for t in teams) or 'none'}."
            + (f" Note: {body.note.strip()}" if body.note and body.note.strip() else "")
        )
        await conn.execute(
            "INSERT INTO feedback (user_id, submitted_by, message, page_url) VALUES ($1, $2, $3, $4)",
            payload["user_id"], who or "Unknown", message, f"/leagues/{league_id}",
        )
        if not monitoring.is_test_request(request):
            await admin_alerts.alert_feedback(conn, who or "Unknown", message, False, owner_id)
    return {"reported": True}


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
        linked = await league_queries.linked_owners_in_league(conn, league_id)
        my_teams = await team_queries.teams_for_user_in_league(conn, league_id, payload["user_id"])
    # Your own team here, if your account already has one (an ESPN league
    # whose teams include managers already on The Weekend): nothing to
    # pick. Several means one login runs them all: you say which is yours
    # (POST my-team) rather than us guessing. Everyone else already here
    # is named, not silently left out.
    yours = my_teams[0] if len(my_teams) == 1 else None
    return {
        "owners": [dict(r) for r in rows],
        "yours": {"owner_id": yours["owner_id"], "team_name": yours["team_name"]} if yours else None,
        "shared_login": [{"team_id": t["team_id"], "team_name": t["team_name"]} for t in my_teams]
        if len(my_teams) > 1 else [],
        "already_here": [
            {"display_name": r["display_name"], "team_name": r["team_name"], "member": r["member"]}
            for r in linked
            if r["user_id"] != payload["user_id"]
        ],
    }


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
        claimed_owner_id = body.owner_id
        claimed = await league_queries.claim_owner(conn, league_id, body.owner_id, payload["user_id"])
        if not claimed:
            # A league brought in from ESPN/Sleeper (2026-10-24): its teams'
            # owners were made by the sync, but the person claiming one
            # usually has an owner here already (one per account). Their
            # team is merged into the owner they already have; the sync
            # then maps that ESPN/Sleeper user to them for good.
            merged = await _merge_synced_owner(conn, league_id, body.owner_id, payload["user_id"])
            if merged is not None:
                claimed, claimed_owner_id = True, merged
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
        await chat_queries.add_owner_to_league_conversations(conn, league_id, claimed_owner_id)
        token_version = await auth_queries.get_token_version(conn, payload["user_id"])

    config = SessionConfig()
    token = create_session_token(
        config.session_secret,
        user_id=payload["user_id"],
        owner_id=claimed_owner_id,
        discord_user_id=payload.get("discord_user_id"),
        is_commissioner=payload.get("is_commissioner", False),
        token_version=token_version,
    )
    return {"owner_id": claimed_owner_id, "claimed": True, "token": token}


async def _merge_synced_owner(conn, league_id: int, owner_id: int, user_id: int) -> int | None:
    """Claiming a synced team with an account that already has an owner:
    only in a league connected to (or moved over from) ESPN/Sleeper, only
    an unclaimed owner with a team in this league, and only while the
    caller has no team of their own here yet. Returns the caller's owner."""
    from app.domain.league_mode import mirror_platform
    from app.domain.owner_merge import merge_owners

    connected = await mirror_platform(conn, league_id) or await conn.fetchval(
        "SELECT 1 FROM league_switches WHERE league_id = $1", league_id
    )
    mine = await auth_queries.get_owner_id_for_user(conn, user_id)
    if not connected or mine is None or mine == owner_id:
        return None
    eligible = await conn.fetchval(
        """
        SELECT 1 FROM teams_by_season t
        WHERE t.owner_id = $1 AND t.league_id = $2
          AND NOT EXISTS (SELECT 1 FROM owner_users ou WHERE ou.owner_id = $1)
          AND NOT EXISTS (SELECT 1 FROM teams_by_season m WHERE m.owner_id = $3 AND m.league_id = $2)
        """,
        owner_id, league_id, mine,
    )
    if not eligible:
        return None
    await merge_owners(conn, owner_id, mine)
    return mine


@router.post("/co-owner-invite")
async def create_co_owner_invite(request: Request):
    """Lets a team's owner (or an existing co-owner — resolve_owner_id
    already resolves either of them to the exact same owner_id, since
    sharing that one identity is the whole point) generate a single-
    use link a friend can redeem to become a co-owner: both people
    then act as this exact owner_id everywhere (chat, trades, lineup,
    push — all already owner_id-keyed, unchanged by this feature).
    Not scoped to one league/team in the URL — resolve_owner_id is
    already the caller's real security boundary here, and the invite
    itself, once redeemed, shares the whole owner identity (every
    league/team it has), not just one team, since there's no smaller
    unit to share (see app/queries/leagues.py's create_co_owner_invite).
    """
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        if owner_id is None:
            raise HTTPException(status_code=403, detail="You don't have a team to invite a co-owner to")
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
        old_name = await conn.fetchval("SELECT name FROM leagues WHERE id = $1", league_id)
        await league_queries.rename_league(conn, league_id, name)
        if old_name != name:
            await commish_log.record(conn, league_id, payload["user_id"], "league", f"League name: {old_name} → {name}")
        row = await league_queries.get_league(conn, league_id)
    return _league_dict(row)


class HouseRulesRequest(BaseModel):
    chug_enabled: bool | None = None
    chug_rule_name: str | None = None


@router.patch("/{league_id}/house-rules")
async def update_house_rules(league_id: int, body: HouseRulesRequest, request: Request):
    """Commissioner-only (2026-10). The chug rule started as League #1's
    own tradition; any league can now turn it on and name it."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        before = await conn.fetchrow("SELECT chug_enabled, chug_rule_name FROM leagues WHERE id = $1", league_id)
        if body.chug_enabled is not None:
            await conn.execute("UPDATE leagues SET chug_enabled = $2 WHERE id = $1", league_id, body.chug_enabled)
        if body.chug_rule_name is not None:
            name = body.chug_rule_name.strip()[:40] or None
            await conn.execute("UPDATE leagues SET chug_rule_name = $2 WHERE id = $1", league_id, name)
        row = await league_queries.get_league(conn, league_id)
        rule = row["chug_rule_name"] or "Chug rule"
        if before["chug_enabled"] != row["chug_enabled"]:
            await commish_log.record(conn, league_id, payload["user_id"], "league", f"Turned {rule} {'on' if row['chug_enabled'] else 'off'}")
        elif before["chug_rule_name"] != row["chug_rule_name"]:
            await commish_log.record(conn, league_id, payload["user_id"], "league", f"Renamed the house rule to {rule}")
    return _league_dict(row)


class UpdateFormatRequest(BaseModel):
    league_type: str | None = None
    matchup_type: str | None = None
    draft_type: str | None = None
    roster_preset: str | None = None
    type_settings: dict | None = None


@router.patch("/{league_id}/format")
async def update_league_format(league_id: int, body: UpdateFormatRequest, request: Request):
    """Commissioner-only (2026-10). The league type, roster and draft
    style shape the draft itself, so they change only until the draft
    is set up (reset it to change them after). Head-to-head vs total
    points only changes how standings rank, so it can change any time."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        current = await league_format.get_league_format(conn, league_id)
        choices = {
            "league_type": body.league_type or current["league_type"],
            "matchup_type": body.matchup_type or current["matchup_type"],
            "draft_type": body.draft_type or current["draft_type"],
            "roster_preset": body.roster_preset or current["roster_preset"],
        }
        for field, value in choices.items():
            if value not in getattr(league_format, f"{field.upper()}S"):
                raise HTTPException(status_code=422, detail=f"Unknown {field.replace('_', ' ')}: {value}")
        shapes_draft = any(choices[f] != current[f] for f in ("league_type", "draft_type", "roster_preset")) or (
            body.type_settings is not None
        )
        if shapes_draft:
            if await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id):
                raise HTTPException(
                    status_code=409,
                    detail="The draft is already set up. Reset it in Draft Setup to change the league type, roster or draft style.",
                )
            changed = {f: choices[f] for f in choices if choices[f] != current[f]}
            if league_format.unavailable_choice(changed):
                raise HTTPException(status_code=422, detail="That league format isn't available yet")
        type_settings = league_format.normalize_type_settings(
            choices["league_type"], choices["draft_type"],
            body.type_settings if body.type_settings is not None else current["type_settings"],
        )
        await league_queries.set_league_format(conn, league_id, choices, type_settings)
        format_changes = [f"{f.replace('_', ' ')}: {current[f]} → {choices[f]}" for f in choices if choices[f] != current[f]]
        if body.type_settings is not None and type_settings != current["type_settings"]:
            format_changes.append("league type settings")
        if format_changes:
            await commish_log.record(conn, league_id, payload["user_id"], "league", "League format: " + "; ".join(format_changes))
        if shapes_draft:
            await draft_queries.upsert_roster_slots_setting(
                conn, season,
                league_format.roster_slots_for(choices["roster_preset"], choices["league_type"], type_settings),
                league_id,
            )
            if choices["league_type"] == "keeper":
                await keeper_queries.upsert_rules(conn, season, type_settings["keepers_per_team"], None, None, league_id)
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
        who = await commish_log.user_name(conn, user_id)
        await commish_log.record(
            conn, league_id, payload["user_id"], "members",
            f"Made {who} a co-commissioner" if body.role == "commissioner" else f"Made {who} a regular member",
        )
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
        who = await commish_log.user_name(conn, user_id)
        removed = await league_queries.remove_member(conn, league_id, user_id)
        if not removed:
            raise HTTPException(status_code=404, detail="That user isn't a member of this league")
        await commish_log.record(conn, league_id, payload["user_id"], "members", f"Removed {who} from the league")
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
        team_name = await conn.fetchval("SELECT team_name FROM teams_by_season WHERE id = $1", team_id)
        await commish_log.record(
            conn, league_id, payload["user_id"], "teams",
            f"Gave {team_name or 'a team'} to {await commish_log.user_name(conn, body.user_id)}",
        )
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
        await commish_log.record(conn, league_id, payload["user_id"], "teams", f"Created {team_name} for {display_name}")
    return team
