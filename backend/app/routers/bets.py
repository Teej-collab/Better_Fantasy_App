"""
Bet tracking — tracking only: nothing here places a bet or moves money.

- POST /bets/parse-slip: a bet-slip screenshot in, a draft bet out
  (read by Claude, app/providers/bet_slip_reader.py). The image is never
  stored. The user checks the draft before saving.
- POST /bets, GET /bets, PATCH/DELETE /bets/{id}: the user's own bets,
  graded live from ESPN's box score (app/domain/bets.py) and settled
  for good once each leg's game is final.
- GET /bets/games/{event_id}: the user's legs riding on one NFL game,
  for the Gamecast's Your Bets card.
- POST /bets/{id}/share: posts the bet to the user's league chat as a
  live bet card (messages.bet_id). GET /bets/shared/{id} is how league
  members read a shared bet; unsharing makes that card say so.

Private by default: every route resolves the user from the session —
there's no user_id parameter anywhere — and a bet is readable by anyone
else only while shared, and only by members of its league.
"""
import asyncio
import base64
import binascii
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.league_context import _decode_session_or_401, resolve_owner_id
from app.auth.rate_limit import _check as check_rate_limit
from app.chat.manager import manager
from app.db import get_pool
from app.domain import bets as bet_domain
from app.domain import chat as chat_domain
from app.providers import bet_slip_reader
from app.providers.nfl_scoreboard import get_nfl_scoreboard
from app.providers.nfl_stats.espn_public import get_game_stats
from app.queries import bets as bet_queries
from app.queries import chat as chat_queries
from app.queries import leagues as league_queries
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bets", tags=["bets"])

# Each read costs a Claude call — plenty for real use, a ceiling on abuse.
_PARSE_WINDOW_SECONDS = 24 * 60 * 60
_PARSE_MAX_PER_WINDOW = 40
_MAX_IMAGE_BYTES = 6 * 1024 * 1024
_ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_LEGS = 25
_BET_STATUSES = {"open", "won", "lost", "push", "void", "cashed_out"}


# ---- Shapes ----

class LegIn(BaseModel):
    description: str = Field(max_length=300)
    market: str
    player_name: str | None = Field(default=None, max_length=80)
    team_abbr: str | None = Field(default=None, max_length=4)
    stat_key: str | None = None
    line: float | None = None
    direction: str | None = None
    odds_american: int | None = None


class BetIn(BaseModel):
    sportsbook: str | None = Field(default=None, max_length=40)
    stake: float | None = Field(default=None, ge=0, le=1_000_000)
    odds_american: int | None = Field(default=None, ge=-100_000, le=1_000_000)
    payout: float | None = Field(default=None, ge=0, le=100_000_000)
    note: str | None = Field(default=None, max_length=280)
    source: str = "manual"
    legs: list[LegIn] = Field(min_length=1, max_length=_MAX_LEGS)


class SlipIn(BaseModel):
    image_base64: str
    media_type: str = "image/jpeg"


class BetPatch(BaseModel):
    # "auto" hands the result back to automatic grading.
    status: str | None = None
    note: str | None = Field(default=None, max_length=280)


class LegPatch(BaseModel):
    status: str


# ---- Helpers ----

def _cents(dollars: float | None) -> int | None:
    return round(dollars * 100) if dollars is not None else None


async def _enabled(conn, owner_id: int | None) -> bool:
    if owner_id is None:
        return True
    return bool((await preferences_queries.get_preferences(conn, owner_id))["bet_tracking_enabled"])


async def _match_player(conn, name: str | None, team: str | None) -> dict | None:
    """The players row for a slip's name — exact (accent/suffix-blind)
    name match, preferring the slip's team when it gave one."""
    key = bet_domain.name_key(name)
    if not key:
        return None
    last = key.split()[-1]
    candidates = [r for r in await bet_queries.players_by_last_name(conn, last) if bet_domain.name_key(r["full_name"]) == key]
    if team:
        on_team = [r for r in candidates if r["pro_team"] == team]
        if on_team:
            return dict(on_team[0])
    return dict(candidates[0]) if candidates else None


def _game_for_team(games: list[dict], team: str | None) -> dict | None:
    if not team:
        return None
    return next((g for g in games if team in (g.get("home_team"), g.get("away_team"))), None)


async def _resolve_legs(conn, legs: list[dict]) -> list[dict]:
    """Ties each leg to a real player and this week's NFL game."""
    try:
        games = await get_nfl_scoreboard()
    except Exception:
        logger.warning("Scoreboard unavailable while resolving bet legs", exc_info=True)
        games = []
    out = []
    for leg in legs:
        leg = dict(leg)
        if leg["market"] == "player_prop" or leg.get("player_name"):
            player = await _match_player(conn, leg.get("player_name"), leg.get("team_abbr"))
            if player:
                leg["espn_player_id"] = player["espn_player_id"]
                leg["sleeper_player_id"] = player["sleeper_player_id"]
                leg["player_name"] = player["full_name"]
                leg["team_abbr"] = player["pro_team"] or leg.get("team_abbr")
        game = _game_for_team(games, leg.get("team_abbr"))
        leg["espn_event_id"] = game["id"] if game else None
        out.append(leg)
    return out


async def _game_contexts(event_ids: set[str]) -> dict[str, dict]:
    """event id → {"scoreline", "prop_stats", "final"} (cached upstream:
    10s while live, 30 min once final)."""
    async def one(event_id: str):
        try:
            return event_id, await get_game_stats(event_id)
        except Exception:
            logger.warning("Couldn't load stats for event %s", event_id, exc_info=True)
            return event_id, None

    results = await asyncio.gather(*(one(e) for e in event_ids))
    return {e: r for e, r in results if r is not None}


def _player_stats(ctx: dict | None, leg) -> dict | None:
    if not ctx:
        return None
    props = ctx.get("prop_stats") or {}
    if leg["espn_player_id"] is not None and leg["espn_player_id"] in props:
        return props[leg["espn_player_id"]]["stats"]
    key = bet_domain.name_key(leg["player_name"])
    for p in props.values():
        if key and bet_domain.name_key(p.get("player_name")) == key:
            return p["stats"]
    return None


def _num(value):
    return float(value) if value is not None else None


async def _build(conn, bet_rows: list, persist: bool) -> list[dict]:
    """Bets with every leg graded against its game right now. When
    `persist`, legs whose game is final (and the bets they settle) are
    saved, so history stays put without re-fetching old box scores."""
    legs_by_bet = await bet_queries.legs_for_bets(conn, [b["id"] for b in bet_rows])
    events = {l["espn_event_id"] for legs in legs_by_bet.values() for l in legs if l["espn_event_id"] and l["status"] == "open"}
    contexts = await _game_contexts(events)
    names = await bet_queries.bet_owner_names(conn, list({b["user_id"] for b in bet_rows}))

    out = []
    for b in bet_rows:
        legs_out = []
        for leg in legs_by_bet.get(b["id"], []):
            ctx = contexts.get(leg["espn_event_id"]) if leg["espn_event_id"] else None
            scoreline = (ctx or {}).get("scoreline")
            if leg["status"] != "open":
                graded = {"status": leg["status"], "current": _num(leg["final_value"]), "target": _num(leg["line"])}
            else:
                graded = bet_domain.evaluate_leg(
                    {
                        "market": leg["market"], "stat_key": leg["stat_key"], "line": _num(leg["line"]),
                        "direction": leg["direction"], "team_abbr": leg["team_abbr"],
                    },
                    scoreline,
                    _player_stats(ctx, leg),
                )
                # Saved once it can't change: the game's over, or an
                # over/yes already cashed (it can't un-hit).
                if persist and graded["status"] != "open" and (ctx and ctx.get("final") or graded["status"] == "won"):
                    await bet_queries.settle_leg(conn, leg["id"], graded["status"], graded["current"])
            legs_out.append(
                {
                    "id": leg["id"],
                    "description": leg["description"],
                    "market": leg["market"],
                    "player_name": leg["player_name"],
                    "sleeper_player_id": leg["sleeper_player_id"],
                    "team_abbr": leg["team_abbr"],
                    "stat_key": leg["stat_key"],
                    "stat_label": bet_domain.STAT_KEYS[leg["stat_key"]][0] if leg["stat_key"] in bet_domain.STAT_KEYS else None,
                    "line": _num(leg["line"]),
                    "direction": leg["direction"],
                    "odds_american": leg["odds_american"],
                    "espn_event_id": leg["espn_event_id"],
                    "game": (
                        {
                            "state": scoreline.get("state"),
                            "home_team": scoreline.get("home_team"),
                            "away_team": scoreline.get("away_team"),
                            "home_score": scoreline.get("home_score"),
                            "away_score": scoreline.get("away_score"),
                        }
                        if scoreline
                        else None
                    ),
                    "status": graded["status"],
                    "current": graded["current"],
                    "target": graded["target"],
                    "tracked": leg["market"] != "other" and (leg["espn_event_id"] is not None),
                }
            )
        status = b["status"]
        if not b["status_set_manually"]:
            status = bet_domain.bet_status([l["status"] for l in legs_out])
            if persist and status != b["status"] and (status != "open" or b["status"] != "open"):
                await bet_queries.settle_bet(conn, b["id"], status)
        out.append(
            {
                "id": b["id"],
                "owner_name": names.get(b["user_id"], "Someone"),
                "sportsbook": b["sportsbook"],
                "stake": b["stake_cents"] / 100 if b["stake_cents"] is not None else None,
                "odds_american": b["odds_american"],
                "payout": b["payout_cents"] / 100 if b["payout_cents"] is not None else None,
                "status": status,
                "status_set_manually": b["status_set_manually"],
                "note": b["note"],
                "shared": b["shared_at"] is not None,
                "created_at": b["created_at"].isoformat(),
                "legs": legs_out,
            }
        )
    return out


def _public(bet: dict) -> dict:
    """A shared bet as league members see it: the picks and how they're
    doing. The stake, payout and note stay private to the bettor."""
    return {k: v for k, v in bet.items() if k not in ("stake", "payout", "note", "status_set_manually")}


# ---- Routes ----

@router.get("")
async def list_bets(request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        enabled = await _enabled(conn, owner_id)
        if not enabled:
            return {"enabled": False, "bets": []}
        rows = await bet_queries.list_user_bets(conn, payload["user_id"])
        return {"enabled": True, "bets": await _build(conn, rows, persist=True)}


@router.post("/parse-slip")
async def parse_slip(body: SlipIn, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    if body.media_type not in _ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=422, detail="Use a JPEG, PNG or WebP screenshot")
    try:
        raw = base64.b64decode(body.image_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="That image couldn't be read")
    if len(raw) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="That screenshot is too large")
    check_rate_limit(f"bet-slip:{payload['user_id']}", _PARSE_WINDOW_SECONDS, _PARSE_MAX_PER_WINDOW)
    try:
        slip = await asyncio.to_thread(bet_slip_reader.read_bet_slip, body.image_base64, body.media_type)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("Bet slip read failed")
        raise HTTPException(status_code=502, detail="Couldn't read that slip — try again, or enter it by hand")
    if not slip.get("is_bet_slip", True) or not slip.get("legs"):
        raise HTTPException(status_code=422, detail="That doesn't look like a bet slip")
    legs = [bet_domain.normalize_leg(l) for l in slip["legs"][:_MAX_LEGS]]
    async with pool.acquire() as conn:
        legs = await _resolve_legs(conn, legs)
    return {
        "sportsbook": slip.get("sportsbook"),
        "stake": slip.get("stake"),
        "odds_american": slip.get("odds_american"),
        "payout": slip.get("payout"),
        "legs": [
            {k: leg.get(k) for k in ("description", "market", "player_name", "team_abbr", "stat_key", "line", "direction", "odds_american")}
            | {"matched": leg.get("espn_event_id") is not None}
            for leg in legs
        ],
    }


@router.post("")
async def create_bet(body: BetIn, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    legs = [bet_domain.normalize_leg(l.model_dump()) for l in body.legs]
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        league_id = await league_queries.get_active_league_id(conn, payload["user_id"])
        legs = await _resolve_legs(conn, legs)
        stake = _cents(body.stake)
        payout = _cents(body.payout) or bet_domain.american_payout_cents(stake, body.odds_american)
        bet_id = await bet_queries.insert_bet(
            conn, payload["user_id"], owner_id, league_id,
            {
                "sportsbook": (body.sportsbook or "").strip() or None,
                "stake_cents": stake,
                "odds_american": body.odds_american,
                "payout_cents": payout,
                "source": body.source if body.source in ("screenshot", "manual") else "manual",
                "note": (body.note or "").strip() or None,
            },
            legs,
        )
        row = await bet_queries.get_user_bet(conn, payload["user_id"], bet_id)
        return (await _build(conn, [row], persist=False))[0]


@router.get("/games/{event_id}")
async def bets_in_game(event_id: str, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        if not await _enabled(conn, owner_id):
            return {"enabled": False, "bets": []}
        ids = await bet_queries.user_bet_ids_in_game(conn, payload["user_id"], event_id)
        rows = [r for r in [await bet_queries.get_user_bet(conn, payload["user_id"], i) for i in ids] if r]
        bets = await _build(conn, rows, persist=True)
        return {"enabled": True, "bets": bets}


@router.get("/shared/{bet_id}")
async def shared_bet(bet_id: int, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        row = await bet_queries.get_shared_bet(conn, bet_id)
        if row is None:
            raise HTTPException(status_code=404, detail="This bet isn't shared anymore")
        if row["user_id"] != payload["user_id"]:
            membership = row["league_id"] and await league_queries.get_membership(conn, row["league_id"], payload["user_id"])
            if not membership:
                raise HTTPException(status_code=404, detail="This bet isn't shared anymore")
        bet = (await _build(conn, [row], persist=False))[0]
        return bet if row["user_id"] == payload["user_id"] else _public(bet)


@router.patch("/{bet_id}")
async def update_bet(bet_id: int, body: BetPatch, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    fields = body.model_dump(exclude_unset=True)
    async with pool.acquire() as conn:
        if await bet_queries.get_user_bet(conn, payload["user_id"], bet_id) is None:
            raise HTTPException(status_code=404, detail="Bet not found")
        if "status" in fields:
            status = fields["status"]
            if status != "auto" and status not in _BET_STATUSES:
                raise HTTPException(status_code=422, detail="Unknown status")
            await bet_queries.set_bet_status_manually(conn, payload["user_id"], bet_id, None if status == "auto" else status)
        if "note" in fields:
            await bet_queries.update_bet_note(conn, payload["user_id"], bet_id, (fields["note"] or "").strip() or None)
        row = await bet_queries.get_user_bet(conn, payload["user_id"], bet_id)
        return (await _build(conn, [row], persist=True))[0]


@router.patch("/{bet_id}/legs/{leg_id}")
async def update_leg(bet_id: int, leg_id: int, body: LegPatch, request: Request, pool=Depends(get_pool)):
    """Marks a leg the app can't grade (or corrects one)."""
    payload = _decode_session_or_401(request)
    if body.status not in bet_domain.LEG_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")
    async with pool.acquire() as conn:
        if await bet_queries.get_user_bet(conn, payload["user_id"], bet_id) is None:
            raise HTTPException(status_code=404, detail="Bet not found")
        if not await bet_queries.set_leg_status(conn, bet_id, leg_id, body.status):
            raise HTTPException(status_code=404, detail="Leg not found")
        row = await bet_queries.get_user_bet(conn, payload["user_id"], bet_id)
        return (await _build(conn, [row], persist=True))[0]


@router.delete("/{bet_id}")
async def remove_bet(bet_id: int, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        if not await bet_queries.delete_bet(conn, payload["user_id"], bet_id):
            raise HTTPException(status_code=404, detail="Bet not found")
    return {"deleted": True}


@router.post("/{bet_id}/share")
async def share_bet(bet_id: int, request: Request, pool=Depends(get_pool)):
    """Shares the bet with the league and posts it to league chat as a
    live bet card. Sharing again doesn't post a second card."""
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        bet = await bet_queries.get_user_bet(conn, payload["user_id"], bet_id)
        if bet is None:
            raise HTTPException(status_code=404, detail="Bet not found")
        owner_id = await resolve_owner_id(conn, payload)
        league_id = bet["league_id"] or await league_queries.get_active_league_id(conn, payload["user_id"])
        conversation_id = await chat_queries.get_league_conversation_id(conn, league_id) if league_id else None
        if owner_id is None or conversation_id is None:
            raise HTTPException(status_code=409, detail="Join a league with a team to share bets")
        if not await chat_queries.is_participant(conn, conversation_id, owner_id):
            raise HTTPException(status_code=403, detail="You're not in this league's chat")
        already = bet["shared_at"] is not None and await chat_queries.bet_message_exists(conn, bet_id)
        await bet_queries.set_shared(conn, payload["user_id"], bet_id, True)
        if already:
            return {"shared": True, "posted": False}
        legs = (await bet_queries.legs_for_bets(conn, [bet_id])).get(bet_id, [])
        body = f"🎟️ Shared a {len(legs)}-leg parlay" if len(legs) > 1 else "🎟️ Shared a bet"
        row = await chat_queries.insert_message(conn, conversation_id, owner_id, body, None, None, None, bet_id=bet_id)
        message = await chat_domain.get_single_message(conn, row["id"], owner_id)
        participant_ids = await chat_queries.list_conversation_participant_ids(conn, conversation_id)
    await manager.broadcast_to_owners(participant_ids, {"type": "message", "message": message})
    return {"shared": True, "posted": True, "conversation_id": conversation_id}


@router.delete("/{bet_id}/share")
async def unshare_bet(bet_id: int, request: Request, pool=Depends(get_pool)):
    """Back to private. The chat card stays, but says it's no longer shared."""
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        if await bet_queries.get_user_bet(conn, payload["user_id"], bet_id) is None:
            raise HTTPException(status_code=404, detail="Bet not found")
        await bet_queries.set_shared(conn, payload["user_id"], bet_id, False)
    return {"shared": False}
