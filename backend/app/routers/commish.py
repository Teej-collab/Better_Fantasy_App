"""
Commissioner Tools, the 2026-10-23 overhaul: the hub, the merged Members
& Teams list, the season calendar, waiver rules, trade review with
projections, a note after fixing someone's lineup, Commish Corner posts
(now or scheduled), and the change log. Everything here is for the
caller's active league and commissioner-only, except GET /league/changes,
which any member can read unless the commissioner turned it off.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain import announcements, commish_log, commish_tools, waivers
from app.domain.commish_tools import WAIVER_TYPE_LABELS, WEEKDAYS, hour_label
from app.domain.waiver_settings import WAIVER_TYPES, get_waiver_settings, save_waiver_settings
from app.notifications import dispatcher, formatter
from app.notifications import game_alerts
from app.queries import league as league_queries
from app.queries import owner_preferences as preferences_queries

router = APIRouter(prefix="/league", tags=["commissioner"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    payload = decode_session_token(SessionConfig().session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


def _season() -> int:
    return int(_require("ACTIVE_SEASON"))


@router.get("/commish/summary")
async def commish_summary(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        return await commish_tools.summary(conn, league_id, _season())


@router.get("/commish/members")
async def commish_members(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        league = await conn.fetchrow("SELECT invite_code FROM leagues WHERE id = $1", league_id)
        return {
            "league_id": league_id,
            "invite_code": league["invite_code"],
            "me": payload["user_id"],
            "members": await commish_tools.members(conn, league_id, _season()),
        }


@router.get("/commish/calendar")
async def commish_calendar(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        return await commish_tools.calendar(conn, league_id, _season())


@router.get("/commish/trades")
async def commish_trades(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        return await commish_tools.trade_review(conn, league_id, _season())


# ---- Waivers --------------------------------------------------------------


class WaiverSettingsRequest(BaseModel):
    waiver_type: str
    faab_budget: int = 100
    min_bid: int = 0
    clear_weekday: int = 2
    clear_hour: int = 3
    drop_days: int = 1
    hold_played: bool = True
    post_results: bool = False


@router.get("/commish/waivers")
async def get_commish_waivers(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = _season()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        settings = await get_waiver_settings(conn, league_id)
        pending = await conn.fetchval(
            "SELECT count(*) FROM waiver_claims WHERE season = $1 AND league_id = $2 AND status = 'pending'", season, league_id
        )
        on_wire = await conn.fetchval(
            "SELECT count(*) FROM waiver_wire WHERE season = $1 AND league_id = $2 AND clears_at > now()", season, league_id
        )
        next_run = await conn.fetchval(
            "SELECT MIN(clears_at) FROM waiver_wire WHERE season = $1 AND league_id = $2 AND clears_at > now()", season, league_id
        )
    return {
        "settings": settings,
        "pending_claims": pending,
        "players_on_waivers": on_wire,
        "next_run_at": next_run.isoformat() if next_run else None,
    }


@router.put("/commish/waivers")
async def put_commish_waivers(body: WaiverSettingsRequest, request: Request, pool=Depends(get_pool)):
    if body.waiver_type not in WAIVER_TYPES:
        raise HTTPException(status_code=400, detail="Pick how claims are decided")
    if not 1 <= body.faab_budget <= 10000:
        raise HTTPException(status_code=400, detail="The budget has to be between $1 and $10,000")
    if not 0 <= body.min_bid <= body.faab_budget:
        raise HTTPException(status_code=400, detail="The lowest bid has to be between $0 and the budget")
    if not 0 <= body.clear_weekday <= 6 or not 0 <= body.clear_hour <= 23:
        raise HTTPException(status_code=400, detail="Pick a day and hour for claims to run")
    if not 0 <= body.drop_days <= 7:
        raise HTTPException(status_code=400, detail="Dropped players can wait 0 to 7 days")
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        before = await get_waiver_settings(conn, league_id)
        after = body.model_dump()
        await save_waiver_settings(conn, league_id, after)
        changes = [
            commish_log.change("Waivers", WAIVER_TYPE_LABELS[before["waiver_type"]], WAIVER_TYPE_LABELS[after["waiver_type"]]),
            commish_log.change("FAAB budget", f"${before['faab_budget']}", f"${after['faab_budget']}") if after["waiver_type"] == "faab" else None,
            commish_log.change("Lowest bid", f"${before['min_bid']}", f"${after['min_bid']}") if after["waiver_type"] == "faab" else None,
            commish_log.change(
                "Waivers run",
                f"{WEEKDAYS[before['clear_weekday']]} {hour_label(before['clear_hour'])}",
                f"{WEEKDAYS[after['clear_weekday']]} {hour_label(after['clear_hour'])}",
            ),
            commish_log.change("Dropped players wait", f"{before['drop_days']} day(s)", f"{after['drop_days']} day(s)"),
            commish_log.change("Hold players once their game starts", "on" if before["hold_played"] else "off", "on" if after["hold_played"] else "off"),
            commish_log.change("Post waiver results", "on" if before["post_results"] else "off", "on" if after["post_results"] else "off"),
        ]
        changes = [c for c in changes if c]
        if changes:
            await commish_log.record(conn, league_id, payload["user_id"], "waivers", "; ".join(changes))
        return {"settings": await get_waiver_settings(conn, league_id)}


@router.post("/commish/waivers/run")
async def run_commish_waivers(request: Request, pool=Depends(get_pool)):
    """Runs every claim now instead of waiting for the next run: each
    player on this league's waiver wire clears right away."""
    payload = _require_session(request)
    season = _season()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        week = await league_queries.get_cached_current_week(conn, season)
        if week is None:
            raise HTTPException(status_code=409, detail="The season hasn't started yet")
        await conn.execute(
            "UPDATE waiver_wire SET clears_at = now() WHERE season = $1 AND league_id = $2 AND clears_at > now()", season, league_id
        )
        results = await waivers.process_expired_waivers(conn, season, league_id, week)
        if results:
            await game_alerts.notify_waiver_results(conn, season, league_id, results)
            if (await get_waiver_settings(conn, league_id))["post_results"]:
                await announcements.post_waiver_results(conn, season, league_id, results)
        won = sum(1 for r in results for o in r["outcomes"] if o["status"] == "successful")
        await commish_log.record(
            conn, league_id, payload["user_id"], "waivers",
            f"Ran waivers early: {len(results)} player{'s' if len(results) != 1 else ''} cleared, {won} claim{'s' if won != 1 else ''} won",
        )
    return {"players": len(results), "claims_won": won}


# ---- Fix a lineup ---------------------------------------------------------


class LineupNoteRequest(BaseModel):
    team_id: int
    note: str


@router.post("/commish/lineup-note")
async def send_lineup_note(body: LineupNoteRequest, request: Request, pool=Depends(get_pool)):
    """After changing a member's lineup (the roster/move, add, drop
    endpoints in commissioner_lineup.py), tell them why."""
    note = body.note.strip()[:500]
    if not note:
        raise HTTPException(status_code=400, detail="Write a note")
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        team = await conn.fetchrow(
            "SELECT owner_id, team_name FROM teams_by_season WHERE id = $1 AND league_id = $2 AND season = $3",
            body.team_id, league_id, _season(),
        )
        if team is None:
            raise HTTPException(status_code=404, detail="That team isn't in your league")
        sent = False
        if team["owner_id"] is not None:
            prefs = await preferences_queries.get_preferences(conn, team["owner_id"])
            if prefs["push_enabled"]:
                await dispatcher.send_to_owner(conn, team["owner_id"], formatter.commish_lineup_note(note))
                sent = True
        await commish_log.record(conn, league_id, payload["user_id"], "lineups", f"Note to {team['team_name']}: {note}")
    return {"sent": sent}


# ---- Commish Corner -------------------------------------------------------


class AnnouncementRequest(BaseModel):
    title: str
    body: str
    notify: bool = True
    send_at: datetime | None = None


@router.get("/commish/announcements")
async def list_announcements(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        try:
            scheduled = await announcements.list_scheduled(conn, league_id)
        except Exception:
            scheduled = []
        return {
            "scheduled": scheduled,
            "recent": await announcements.list_recent_posts(conn, league_id),
            "conversation_id": await announcements.corner_id(conn, league_id),
        }


@router.post("/commish/announcements")
async def create_announcement(body: AnnouncementRequest, request: Request, pool=Depends(get_pool)):
    title, text = body.title.strip(), body.body.strip()
    if not title or len(title) > announcements.MAX_TITLE_LENGTH:
        raise HTTPException(status_code=400, detail="Give it a headline (up to 200 characters)")
    if not text or len(text) > announcements.MAX_BODY_LENGTH:
        raise HTTPException(status_code=400, detail="Write the announcement")
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        if body.send_at is not None and body.send_at > datetime.now(timezone.utc):
            scheduled_id = await announcements.schedule(conn, league_id, payload["user_id"], title, text, body.notify, body.send_at)
            await commish_log.record(
                conn, league_id, payload["user_id"], "announcements",
                f"Scheduled “{title}” for {commish_log.when(body.send_at)}",
            )
            return {"scheduled_id": scheduled_id, "message_id": None}
        message_id = await announcements.post(conn, league_id, payload["user_id"], title, text, body.notify)
        if message_id is None:
            raise HTTPException(status_code=409, detail="This league doesn't have a Commish Corner yet")
        await commish_log.record(conn, league_id, payload["user_id"], "announcements", f"Posted “{title}”")
    return {"scheduled_id": None, "message_id": message_id}


@router.delete("/commish/announcements/{announcement_id}")
async def cancel_announcement(announcement_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        if not await announcements.cancel(conn, league_id, announcement_id):
            raise HTTPException(status_code=404, detail="That post already went out or was cancelled")
        await commish_log.record(conn, league_id, payload["user_id"], "announcements", "Cancelled a scheduled post")
    return {"cancelled": True}


# ---- Change log -----------------------------------------------------------


class LogVisibilityRequest(BaseModel):
    public: bool


@router.get("/commish/log")
async def commish_log_list(request: Request, before_id: int | None = None, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        public = await conn.fetchval("SELECT commish_log_public FROM leagues WHERE id = $1", league_id)
        return {"public": public, "changes": await commish_log.list_changes(conn, league_id, 100, before_id)}


@router.put("/commish/log/visibility")
async def commish_log_visibility(body: LogVisibilityRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await conn.execute("UPDATE leagues SET commish_log_public = $2 WHERE id = $1", league_id, body.public)
        await commish_log.record(
            conn, league_id, payload["user_id"], "league",
            "Members can see the change log" if body.public else "Made the change log commissioner-only",
        )
    return {"public": body.public}


@router.get("/changes")
async def league_changes(request: Request, pool=Depends(get_pool)):
    """The change log, for any member of a league that shows it."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        try:
            public = await conn.fetchval("SELECT commish_log_public FROM leagues WHERE id = $1", league_id)
        except Exception:
            return {"public": False, "changes": []}
        if not public:
            return {"public": False, "changes": []}
        return {"public": True, "changes": await commish_log.list_changes(conn, league_id, 50)}
