"""Trades — propose/accept/reject/cancel a two-team player swap, plus
commissioner review when a league's trade settings require it, and the
trade-settings themselves (deadline, review-required toggle). See
app/domain/trades.py for the actual validation/roster-mutation logic;
this router only resolves session/team context and maps domain
exceptions to HTTP status codes, matching every other router's
convention in this app (see app/routers/me.py's _map_lineup_error).

The proposing/responding team is always resolved from the caller's own
session (owner_id + their active league), never accepted from the
client — same discipline app/routers/me.py's _require_my_team uses.
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.domain import trades as trades_domain
from app.domain.trade_exceptions import (
    NotYourTradeError,
    TradeError,
    TradeNotAwaitingReviewError,
    TradeNotFoundError,
    TradeNotPendingError,
)
from app.queries import teams as team_queries

router = APIRouter(prefix="/trades", tags=["trades"])


def _require_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


def _map_trade_error(e: Exception) -> HTTPException:
    if isinstance(e, TradeNotFoundError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, NotYourTradeError):
        return HTTPException(status_code=403, detail=str(e))
    if isinstance(e, (TradeNotPendingError, TradeNotAwaitingReviewError)):
        return HTTPException(status_code=409, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


async def _require_my_team(conn, payload: dict, season: int) -> tuple[int, int]:
    """Returns (team_id, league_id) for the caller's own team in their
    active league."""
    league_id = await require_active_league_id(conn, payload)
    team = await conn.fetchrow(
        "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
        season, payload["owner_id"], league_id,
    )
    if team is None:
        raise HTTPException(status_code=404, detail="No team found for this owner")
    return team["id"], league_id


def _trade_dict(trade: dict) -> dict:
    return {
        "id": trade["id"],
        "league_id": trade["league_id"],
        "season": trade["season"],
        "proposing_team_id": trade["proposing_team_id"],
        "receiving_team_id": trade["receiving_team_id"],
        "status": trade["status"],
        "proposed_at": trade["proposed_at"],
        "resolved_at": trade["resolved_at"],
        "assets": trade["assets"],
    }


@router.get("/teams")
async def league_teams(request: Request, pool=Depends(get_pool)):
    """Every team in the caller's active league — powers the "who do
    you want to trade with" picker."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rows = await team_queries.list_teams_for_league(conn, league_id, season)
    return {"teams": [dict(r) for r in rows]}


@router.get("/teams/{team_id}/roster")
async def team_roster(team_id: int, request: Request, pool=Depends(get_pool)):
    """Any league member can view any team's current roster — you need
    to see the other side's roster to propose a trade with them."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        await require_active_league_id(conn, payload)
        roster = await trades_domain.get_team_roster_for_trade(conn, season, team_id)
    return {"roster": roster}


class ProposeTradeRequest(BaseModel):
    receiving_team_id: int
    give: list[str]
    receive: list[str]


@router.post("")
async def propose_trade(body: ProposeTradeRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        try:
            trade = await trades_domain.propose_trade(
                conn, league_id, season, team_id, body.receiving_team_id, body.give, body.receive
            )
        except TradeError as e:
            raise _map_trade_error(e) from e
    return _trade_dict(trade)


@router.get("/mine")
async def my_trades(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, _ = await _require_my_team(conn, payload, season)
        trades_list = await trades_domain.list_trades_for_team(conn, team_id)
    return {"trades": [_trade_dict(t) for t in trades_list]}


@router.get("/pending")
async def pending_trades(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        trades_list = await trades_domain.list_pending_review(conn, league_id, season)
    return {"trades": [_trade_dict(t) for t in trades_list]}


@router.post("/{trade_id}/accept")
async def accept_trade(trade_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        try:
            trade = await trades_domain.respond_to_trade(conn, trade_id, payload["user_id"], accept=True)
        except TradeError as e:
            raise _map_trade_error(e) from e
    return _trade_dict(trade)


@router.post("/{trade_id}/reject")
async def reject_trade(trade_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        try:
            trade = await trades_domain.respond_to_trade(conn, trade_id, payload["user_id"], accept=False)
        except TradeError as e:
            raise _map_trade_error(e) from e
    return _trade_dict(trade)


@router.post("/{trade_id}/cancel")
async def cancel_trade(trade_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        try:
            trade = await trades_domain.cancel_trade(conn, trade_id, payload["user_id"])
        except TradeError as e:
            raise _map_trade_error(e) from e
    return _trade_dict(trade)


class ReviewTradeRequest(BaseModel):
    approve: bool


@router.post("/{trade_id}/review")
async def review_trade(trade_id: int, body: ReviewTradeRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        await require_league_commissioner(conn, payload)
        try:
            trade = await trades_domain.review_trade(conn, trade_id, body.approve)
        except TradeError as e:
            raise _map_trade_error(e) from e
    return _trade_dict(trade)


class TradeSettingsRequest(BaseModel):
    season: int
    trade_deadline: datetime.datetime | None = None
    review_required: bool = False


@router.get("/settings")
async def get_trade_settings(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        settings = await trades_domain.get_trade_settings(conn, league_id, season)
    return settings


@router.put("/settings")
async def update_trade_settings(body: TradeSettingsRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        settings = await trades_domain.upsert_trade_settings(
            conn, league_id, body.season, body.trade_deadline, body.review_required
        )
    return settings
