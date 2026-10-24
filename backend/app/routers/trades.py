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
from app.auth.league_context import require_active_league_id, require_league_commissioner, resolve_owner_id
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain import commish_log, league_format, league_mode
from app.domain import trade_values
from app.domain import trades as trades_domain
from app.domain.trade_exceptions import (
    NotYourTradeError,
    TradeError,
    TradeNotAwaitingReviewError,
    TradeNotFoundError,
    TradeNotPendingError,
    VetoVoteNotAllowedError,
)
from app.notifications import trade_events
from app.queries import teams as team_queries

router = APIRouter(prefix="/trades", tags=["trades"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
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
    if isinstance(e, (NotYourTradeError, VetoVoteNotAllowedError)):
        return HTTPException(status_code=403, detail=str(e))
    if isinstance(e, (TradeNotPendingError, TradeNotAwaitingReviewError)):
        return HTTPException(status_code=409, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


async def _require_my_team(conn, payload: dict, season: int) -> tuple[int, int]:
    """Returns (team_id, league_id) for the caller's own team in their
    active league."""
    league_id = await require_active_league_id(conn, payload)
    owner_id = await resolve_owner_id(conn, payload)
    team = await conn.fetchrow(
        "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
        season, owner_id, league_id,
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
        "accepted_at": trade.get("accepted_at"),
        "review_ends_at": trade.get("review_ends_at"),
        "expires_at": trade.get("expires_at"),
        "note": trade.get("note"),
        "proposing_team_name": trade.get("proposing_team_name"),
        "receiving_team_name": trade.get("receiving_team_name"),
        "veto_votes": trade.get("veto_votes", 0),
        "my_veto_vote": trade.get("my_veto_vote", False),
        "assets": trade["assets"],
        "drops": trade.get("drops", []),
        "value": trade.get("value"),
    }


async def _with_values(conn, trades_list: list[dict], season: int, my_team_id: int | None) -> list[dict]:
    """Adds each trade's one-line value read (app/domain/trade_values.py)."""
    week = await trade_values.current_week(conn, season)
    ids = sorted({a["sleeper_player_id"] for t in trades_list for a in t["assets"]})
    values = await trade_values.player_values(conn, season, week, ids)
    for t in trades_list:
        t["value"] = trade_values.summary_for(t, my_team_id or 0, values)
    return trades_list


async def _catch_up(conn, league_id: int | None = None) -> None:
    """Processes any trade whose review period or offer window has run
    out — the scheduler does this every minute too, this just makes sure
    nobody ever reads a trade that's past due."""
    changed = await trades_domain.process_due_trades(conn, league_id)
    if changed:
        await trade_events.notify_processed_batch(conn, changed)


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
    to see the other side's roster to propose a trade with them. Each
    player carries their points a week (app/domain/trade_values.py) and
    whether they're on the trade block."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        await require_active_league_id(conn, payload)
        roster = await trades_domain.get_team_roster_for_trade(conn, season, team_id)
        week = await trade_values.current_week(conn, season)
        values = await trade_values.player_values(conn, season, week, [p["sleeper_player_id"] for p in roster])
        on_block = {
            r["sleeper_player_id"]
            for r in await conn.fetch("SELECT sleeper_player_id FROM trade_block WHERE team_id = $1", team_id)
        }
    for p in roster:
        v = values.get(p["sleeper_player_id"], {})
        p["per_week"] = v.get("per_week", 0.0)
        p["pro_team"] = v.get("pro_team")
        p["injury_status"] = v.get("injury_status")
        p["on_block"] = p["sleeper_player_id"] in on_block
    return {"roster": sorted(roster, key=lambda p: -p["per_week"])}


class ProposeTradeRequest(BaseModel):
    receiving_team_id: int
    give: list[str]
    receive: list[str]
    note: str | None = None
    # The proposer's own cuts, when the trade brings them more players
    # than it sends (app/domain/trades.py's trade_drops).
    drops: list[str] = []
    # Answering an offer made to you: that one is declined.
    counter_of: int | None = None


@router.post("")
async def propose_trade(body: ProposeTradeRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        if message := await league_format.best_ball_block(conn, league_id, "roster"):
            raise HTTPException(status_code=409, detail=message)
        try:
            trade = await trades_domain.propose_trade(
                conn, league_id, season, team_id, body.receiving_team_id, body.give, body.receive, body.note,
                drops=body.drops, counter_of=body.counter_of,
            )
        except TradeError as e:
            raise _map_trade_error(e) from e
        await trade_events.notify_trade_event(conn, trade, "proposed")
    return _trade_dict(trade)


@router.get("/mine")
async def my_trades(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        await _catch_up(conn, league_id)
        trades_list = await _with_values(conn, await trades_domain.list_trades_for_team(conn, team_id), season, team_id)
    return {"trades": [_trade_dict(t) for t in trades_list]}


@router.get("/league")
async def league_trades(request: Request, pool=Depends(get_pool)):
    """Every league member's view: trades under review (to vote on, or
    just to see coming) and the last two weeks of finished ones."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        owner_id = await resolve_owner_id(conn, payload)
        my_team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, owner_id, league_id,
        )
        await _catch_up(conn, league_id)
        trades_list = await _with_values(
            conn, await trades_domain.list_league_trades(conn, league_id, season, my_team_id), season, my_team_id
        )
        settings = await trades_domain.get_trade_settings(conn, league_id, season)
    return {"trades": [_trade_dict(t) for t in trades_list], "settings": settings}


@router.post("/{trade_id}/veto-vote")
async def veto_vote(trade_id: int, request: Request, pool=Depends(get_pool)):
    return await _veto_vote(trade_id, request, pool, voting=True)


@router.delete("/{trade_id}/veto-vote")
async def retract_veto_vote(trade_id: int, request: Request, pool=Depends(get_pool)):
    return await _veto_vote(trade_id, request, pool, voting=False)


async def _veto_vote(trade_id: int, request: Request, pool, voting: bool):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        try:
            trade = await trades_domain.vote_to_veto(conn, trade_id, payload["user_id"], voting)
        except TradeError as e:
            raise _map_trade_error(e) from e
        if trade["status"] == "vetoed":
            await trade_events.notify_trade_event(conn, trade, "vetoed")
    return _trade_dict(trade)


@router.get("/pending")
async def pending_trades(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await _catch_up(conn, league_id)
        trades_list = await trades_domain.list_pending_review(conn, league_id, season)
    return {"trades": [_trade_dict(t) for t in trades_list]}


class AcceptTradeRequest(BaseModel):
    # The receiver's cuts to make room, for a trade bringing them more
    # players than it sends.
    drops: list[str] = []


@router.post("/{trade_id}/accept")
async def accept_trade(trade_id: int, request: Request, body: AcceptTradeRequest | None = None, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await conn.fetchval("SELECT league_id FROM trades WHERE id = $1", trade_id)
        if league_id is not None:
            await league_mode.forbid_if_mirrored(conn, league_id)
        try:
            trade = await trades_domain.respond_to_trade(
                conn, trade_id, payload["user_id"], accept=True, drops=body.drops if body else None
            )
        except TradeError as e:
            raise _map_trade_error(e) from e
        settings = await trades_domain.get_trade_settings(conn, trade["league_id"], trade["season"])
        await trade_events.notify_trade_event(conn, trade, "accepted", settings)
    return _trade_dict(trade)


@router.post("/{trade_id}/reject")
async def reject_trade(trade_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        try:
            trade = await trades_domain.respond_to_trade(conn, trade_id, payload["user_id"], accept=False)
        except TradeError as e:
            raise _map_trade_error(e) from e
        await trade_events.notify_trade_event(conn, trade, "rejected")
    return _trade_dict(trade)


@router.post("/{trade_id}/cancel")
async def cancel_trade(trade_id: int, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        try:
            trade = await trades_domain.cancel_trade(conn, trade_id, payload["user_id"])
        except TradeError as e:
            raise _map_trade_error(e) from e
        await trade_events.notify_trade_event(conn, trade, "cancelled")
    return _trade_dict(trade)


class ReviewTradeRequest(BaseModel):
    approve: bool
    # Why the commissioner vetoed it (2026-10-23): sent to both teams.
    reason: str | None = None


@router.post("/{trade_id}/review")
async def review_trade(trade_id: int, body: ReviewTradeRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        try:
            trade = await trades_domain.review_trade(conn, trade_id, body.approve)
        except TradeError as e:
            raise _map_trade_error(e) from e
        await trade_events.notify_trade_event(conn, trade, "processed" if body.approve else "vetoed")
        reason = (body.reason or "").strip()[:300]
        if reason and not body.approve:
            await trade_events.notify_veto_reason(conn, trade, reason)
        teams = f"{trade.get('proposing_team_name') or 'a team'} ↔ {trade.get('receiving_team_name') or 'a team'}"
        await commish_log.record(
            conn, league_id, payload["user_id"], "trades",
            f"Approved a trade: {teams}" if body.approve else f"Vetoed a trade: {teams}" + (f" ({reason})" if reason else ""),
        )
    return _trade_dict(trade)


class TradeSettingsRequest(BaseModel):
    season: int
    trade_deadline: datetime.datetime | None = None
    review_required: bool = False
    # 'none' | 'commissioner' | 'league_vote' | 'approval' — when left
    # out (an older client), review_required decides, as it used to.
    review_mode: str | None = None
    review_hours: int | None = None
    veto_votes_needed: int | None = None


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
        if body.review_mode is not None and body.review_mode not in trades_domain.REVIEW_MODES:
            raise HTTPException(status_code=400, detail="Unknown review mode")
        if body.veto_votes_needed is not None and body.veto_votes_needed < 1:
            raise HTTPException(status_code=400, detail="Veto votes needed must be at least 1")
        before = await trades_domain.get_trade_settings(conn, league_id, body.season)
        settings = await trades_domain.upsert_trade_settings(
            conn, league_id, body.season, body.trade_deadline, body.review_required,
            body.review_mode, body.review_hours, body.veto_votes_needed,
        )
        modes = {"none": "no review", "commissioner": "commissioner review", "league_vote": "league vote", "approval": "commissioner approval"}
        changes = [
            commish_log.change(
                "Trade deadline", commish_log.when(before.get("trade_deadline")), commish_log.when(settings.get("trade_deadline"))
            ),
            commish_log.change(
                "Trade review", modes.get(before.get("review_mode"), before.get("review_mode")),
                modes.get(settings.get("review_mode"), settings.get("review_mode")),
            ),
            commish_log.change("Review period", f"{before.get('review_hours')}h", f"{settings.get('review_hours')}h"),
            commish_log.change("Veto votes needed", before.get("veto_votes_needed") or "default", settings.get("veto_votes_needed") or "default"),
        ]
        changes = [c for c in changes if c]
        if changes:
            await commish_log.record(conn, league_id, payload["user_id"], "trades", "; ".join(changes))
    return settings


# ---- Trades overhaul (2026-10-23): value, lineup impact, the trade block ----


class EvaluateTradeRequest(BaseModel):
    partner_team_id: int
    give: list[str] = []
    receive: list[str] = []
    drops: list[str] = []


@router.post("/evaluate")
async def evaluate_trade(body: EvaluateTradeRequest, request: Request, pool=Depends(get_pool)):
    """The builder's live read on a trade being put together: value
    gap, your lineup before and after, drops needed, and a suggestion
    that would even it out. Nothing is saved."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        partner = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE id = $1 AND league_id = $2 AND season = $3",
            body.partner_team_id, league_id, season,
        )
        if partner is None or partner == team_id:
            raise HTTPException(status_code=404, detail="That team isn't in your league")
        result = await trade_values.evaluate(
            conn, season, league_id, team_id, partner, body.give, body.receive, body.drops
        )
        result["drop_candidates"] = (
            await trade_values.drop_candidates(conn, season, team_id, body.give) if result["my_drops_needed"] else []
        )
    return result


@router.get("/partners")
async def trade_partners(request: Request, pool=Depends(get_pool)):
    """The builder's team list: every other team with its record, what
    it's thin at and deep at, best fits for the caller first."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        return {"teams": await trade_values.partners(conn, season, league_id, team_id)}


@router.get("/{trade_id}/evaluation")
async def trade_evaluation(trade_id: int, request: Request, pool=Depends(get_pool)):
    """The same read for an existing trade, from the caller's side —
    what an offer to you does to your lineup, and who you could drop
    if it brings in more players than it sends."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        trade = await trades_domain.get_trade(conn, trade_id)
        if trade is None or team_id not in (trade["proposing_team_id"], trade["receiving_team_id"]):
            raise HTTPException(status_code=404, detail="Trade not found")
        other = trade["receiving_team_id"] if team_id == trade["proposing_team_id"] else trade["proposing_team_id"]
        give = [a["sleeper_player_id"] for a in trade["assets"] if a["from_team_id"] == team_id]
        receive = [a["sleeper_player_id"] for a in trade["assets"] if a["from_team_id"] == other]
        my_drops = [d["sleeper_player_id"] for d in trade["drops"] if d["team_id"] == team_id]
        result = await trade_values.evaluate(conn, season, league_id, team_id, other, give, receive, my_drops)
        needed = result["my_drops_needed"]
        result["drop_candidates"] = await trade_values.drop_candidates(conn, season, team_id, give) if needed else []
    return result


@router.get("/block")
async def trade_block(request: Request, pool=Depends(get_pool)):
    """Everyone's trade block in the caller's active league, players
    still on the team that listed them."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rows = await conn.fetch(
            """
            SELECT b.team_id, b.sleeper_player_id, b.created_at, t.team_name, p.full_name AS player_name, p.position
            FROM trade_block b
            JOIN current_rosters cr ON cr.team_id = b.team_id AND cr.sleeper_player_id = b.sleeper_player_id AND cr.season = b.season
            JOIN teams_by_season t ON t.id = b.team_id
            JOIN players p ON p.sleeper_player_id = b.sleeper_player_id
            WHERE b.league_id = $1 AND b.season = $2
            ORDER BY b.created_at DESC
            """,
            league_id, season,
        )
        week = await trade_values.current_week(conn, season)
        values = await trade_values.player_values(conn, season, week, [r["sleeper_player_id"] for r in rows])
    return {
        "players": [
            {
                **dict(r),
                "per_week": values.get(r["sleeper_player_id"], {}).get("per_week", 0.0),
                "pro_team": values.get(r["sleeper_player_id"], {}).get("pro_team"),
            }
            for r in rows
        ]
    }


class TradeBlockRequest(BaseModel):
    sleeper_player_id: str


@router.post("/block")
async def add_to_trade_block(body: TradeBlockRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, league_id = await _require_my_team(conn, payload, season)
        await league_mode.forbid_if_mirrored(conn, league_id)
        on_roster = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            season, team_id, body.sleeper_player_id,
        )
        if not on_roster:
            raise HTTPException(status_code=400, detail="That player isn't on your team")
        added = await conn.execute(
            "INSERT INTO trade_block (league_id, season, team_id, sleeper_player_id) VALUES ($1, $2, $3, $4) "
            "ON CONFLICT DO NOTHING",
            league_id, season, team_id, body.sleeper_player_id,
        )
        if added.endswith(" 1"):
            await trade_events.notify_trade_block(conn, league_id, season, team_id)
    return {"ok": True}


@router.delete("/block/{sleeper_player_id}")
async def remove_from_trade_block(sleeper_player_id: str, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        team_id, _ = await _require_my_team(conn, payload, season)
        await conn.execute(
            "DELETE FROM trade_block WHERE team_id = $1 AND sleeper_player_id = $2", team_id, sleeper_player_id
        )
    return {"ok": True}
